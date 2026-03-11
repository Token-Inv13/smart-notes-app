import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login', '/register'];
const SESSION_COOKIE_NAME = 'session';

function buildCsp() {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  const functionsOrigin = projectId ? `https://us-central1-${projectId}.cloudfunctions.net` : null;
  const scriptSrc = process.env.NODE_ENV === 'production'
    ? "'self' 'unsafe-inline' 'unsafe-eval' https://www.gstatic.com https://www.google.com https://apis.google.com https://www.googletagmanager.com https://js.stripe.com"
    : "'self' 'unsafe-inline' 'unsafe-eval' http: https: blob:";
  const connectSrc = [
    "'self'",
    'https://www.google.com',
    'https://www.gstatic.com',
    'https://*.googleapis.com',
    'https://oauth2.googleapis.com',
    'https://identitytoolkit.googleapis.com',
    'https://securetoken.googleapis.com',
    'https://firestore.googleapis.com',
    'https://www.googleapis.com',
    'https://www.google-analytics.com',
    'https://region1.analytics.google.com',
    'https://api.stripe.com',
    'https://*.stripe.com',
    'https://*.firebaseio.com',
    'wss://*.firebaseio.com',
    ...(functionsOrigin ? [functionsOrigin] : []),
  ].join(' ');

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "frame-src 'self' https://accounts.google.com https://*.firebaseapp.com https://www.google.com https://js.stripe.com https://hooks.stripe.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function applySecurityHeaders(response: NextResponse, requestId: string) {
  response.headers.set('X-Request-Id', requestId);
  response.headers.set('Content-Security-Policy', buildCsp());
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');

  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  return response;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();

  if (pathname.startsWith('/api')) {
    return applySecurityHeaders(NextResponse.next(), requestId);
  }

  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return applySecurityHeaders(NextResponse.next(), requestId);
  }

  const isProtectedRoute =
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/tasks') ||
    pathname.startsWith('/notes') ||
    pathname.startsWith('/todo') ||
    pathname.startsWith('/settings') ||
    pathname.startsWith('/admin');

  if (!isProtectedRoute) {
    return applySecurityHeaders(NextResponse.next(), requestId);
  }

  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionCookie) {
    const url = new URL('/login', request.url);
    const fullPath = `${pathname}${request.nextUrl.search}`;
    url.searchParams.set('next', fullPath);
    return applySecurityHeaders(NextResponse.redirect(url), requestId);
  }

  return applySecurityHeaders(NextResponse.next(), requestId);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
