import { NextRequest, NextResponse } from 'next/server';

/**
 * Next.js API Route: Proxy to Chart-API /execute-prompt
 * This eliminates CORS issues by routing through same-origin
 */

const CHART_API_URL = process.env.CHART_API_URL || 'http://localhost:8000';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        // Chart-API /execute-prompt now requires the user's auth token
        // (it's user-scoped so the engine can pick the right warehouse).
        // Forward whatever the browser supplied — header or cookie.
        const token =
            request.headers.get('x-auth-token') ||
            request.cookies.get('token')?.value ||
            '';

        const response = await fetch(`${CHART_API_URL}/execute-prompt`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'x-auth-token': token } : {}),
            },
            body: JSON.stringify(body),
        });

        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        console.error('[Chart Proxy] Error:', error);
        return NextResponse.json(
            { error: 'Failed to connect to Chart API', details: String(error) },
            { status: 500 }
        );
    }
}

// Handle OPTIONS for CORS preflight
export async function OPTIONS() {
    return new NextResponse(null, {
        status: 200,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
    });
}
