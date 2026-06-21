import { NextRequest, NextResponse } from 'next/server';

/**
 * Legacy job-status poll — kept for back-compat with the old pollJobStatus
 * loop in ImportModal. The new engine is synchronous, so the shim on
 * Chart-API always returns { status: "completed" } and the poll exits
 * on the first call.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ jobId: string }> }
) {
    try {
        const engineUrl =
            process.env.NEXT_PUBLIC_DATA_API_URL ||
            process.env.NEXT_PUBLIC_LAKEHOUSE_URL ||
            'http://localhost:8000/api/v1';
        const { jobId } = await params;
        const authToken =
            request.headers.get('x-auth-token') ||
            request.cookies.get('token')?.value ||
            '';

        const response = await fetch(`${engineUrl}/jobs/${jobId}`, {
            headers: authToken ? { 'x-auth-token': authToken } : undefined,
        });
        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        return NextResponse.json(
            { error: 'Failed to get job status', message: String(error) },
            { status: 500 }
        );
    }
}
