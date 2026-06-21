import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
    const token = request.cookies.get('token')?.value;
    const { pathname } = request.nextUrl;

    // Dashboard — requires valid session
    if (pathname.startsWith('/dashboard')) {
        if (!token) {
            const loginUrl = new URL('/login', request.url);
            loginUrl.searchParams.set('from', pathname);
            return NextResponse.redirect(loginUrl);
        }

        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:5000/api/v1';
            const res = await fetch(`${apiUrl}/auth/me`, {
                headers: { 'x-auth-token': token },
            });

            if (res.status === 401) {
                // Token invalid/expired → clear cookie, back to login
                const response = NextResponse.redirect(new URL('/login', request.url));
                response.cookies.delete('token');
                return response;
            }

            if (res.status === 403) {
                // Token valid but user not verified (or insufficient role)
                // → don't delete the cookie, send them to /verify-email instead
                return NextResponse.redirect(new URL('/verify-email', request.url));
            }

            if (!res.ok) {
                // Any other non-2xx: treat as transient and fail closed to login
                return NextResponse.redirect(new URL('/login', request.url));
            }

            return NextResponse.next();
        } catch (error) {
            console.error('Auth validation error:', error);
            // Backend unreachable → go to login (don't wipe token; it may be fine)
            return NextResponse.redirect(new URL('/login', request.url));
        }
    }

    // Public shared dashboard pages — signed tokens, no auth required.
    if (pathname.startsWith('/d/')) {
        return NextResponse.next();
    }

    // Root — landing for anonymous, dashboard for authed
    if (pathname === '/') {
        if (token) {
            return NextResponse.redirect(new URL('/dashboard', request.url));
        }
        return NextResponse.next();
    }

    // Auth pages — skip for already-logged-in users
    if ((pathname.startsWith('/login') || pathname.startsWith('/signup')) && token) {
        return NextResponse.redirect(new URL('/dashboard', request.url));
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - api (API routes)
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         */
        '/((?!api|_next/static|_next/image|favicon.ico).*)',
    ],
};
