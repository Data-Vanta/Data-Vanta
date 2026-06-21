import { NextRequest, NextResponse } from 'next/server';

/**
 * Next.js API Route: Proxy to user-auth chat preview/lakehouse endpoint
 * This adds auth token to requests and eliminates CORS issues
 */

const CHAT_API_URL = process.env.CHAT_API_URL || 'http://localhost:5000/api/v1';

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ jobId: string }> }
) {
    try {
        // In Next.js 15+, params is a Promise and must be awaited
        const { jobId } = await context.params;

        const { searchParams } = new URL(request.url);
        const projectId = searchParams.get('projectId') || '';
        const tableName = searchParams.get('tableName') || '';
        const limit = searchParams.get('limit') || '50';

        // Get token from cookie or Authorization header
        const token = request.cookies.get('token')?.value ||
            request.headers.get('x-auth-token') ||
            request.headers.get('Authorization')?.replace('Bearer ', '');

        if (!token) {
            return NextResponse.json(
                { status: 'fail', message: 'No authentication token' },
                { status: 401 }
            );
        }

        const targetUrl = `${CHAT_API_URL}/chat/preview/lakehouse/${jobId}?projectId=${encodeURIComponent(projectId)}&tableName=${encodeURIComponent(tableName)}&limit=${limit}`;

        console.log('[Chat Preview Proxy] Forwarding to:', targetUrl);

        const response = await fetch(targetUrl, {
            method: 'GET',
            headers: {
                'x-auth-token': token,
            },
        });

        const data = await response.json();
        console.log('[Chat Preview Proxy] Response status:', response.status);

        return NextResponse.json(data, { status: response.status });
    } catch (error) {
        console.error('[Chat Preview Proxy] Error:', error);
        return NextResponse.json(
            { error: 'Failed to fetch preview', details: String(error) },
            { status: 500 }
        );
    }
}
