import { NextRequest, NextResponse } from 'next/server';

// Force Node runtime for multipart handling (Edge has limits).
export const runtime = 'nodejs';

/**
 * Proxy for CSV/XLSX uploads. Forwards multipart form data to the data
 * engine and passes through the caller's `x-auth-token` so the engine
 * can identify the user. The engine is synchronous — the response is
 * the final result, no polling needed (but the legacy {jobId, status}
 * fields are included by the shim for back-compat).
 */
export async function POST(request: NextRequest) {
    const engineUrl =
        process.env.NEXT_PUBLIC_DATA_API_URL ||
        process.env.NEXT_PUBLIC_LAKEHOUSE_URL ||
        'http://localhost:8000/api/v1';

    try {
        const formData = await request.formData();
        const authToken =
            request.headers.get('x-auth-token') ||
            request.cookies.get('token')?.value ||
            '';

        const response = await fetch(`${engineUrl}/upload`, {
            method: 'POST',
            body: formData,
            headers: authToken ? { 'x-auth-token': authToken } : undefined,
        });

        const text = await response.text();
        let data: unknown;
        try {
            data = JSON.parse(text);
        } catch {
            return NextResponse.json(
                { error: 'Invalid response from engine', details: text.slice(0, 200) },
                { status: 502 }
            );
        }
        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        let userMessage = 'Failed to reach data engine';
        let statusCode = 500;
        if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
            userMessage = `Data engine not running at ${engineUrl}`;
            statusCode = 503;
        } else if (msg.includes('ENOTFOUND')) {
            userMessage = 'Cannot resolve engine host; check NEXT_PUBLIC_DATA_API_URL';
            statusCode = 503;
        } else if (msg.includes('timeout')) {
            userMessage = 'Engine timed out';
            statusCode = 504;
        }
        return NextResponse.json({ error: userMessage, message: msg }, { status: statusCode });
    }
}
