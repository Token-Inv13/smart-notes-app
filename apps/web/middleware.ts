import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login', '/register'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  const isProtectedRoute = pathname.startsWith('/dashboard') || pathname.startsWith('/tasks') || pathname.startsWith('/settings');

  if (!isProtectedRoute) {
    return NextResponse.next();
  }

  const isAuthenticated = false;

  if (!isAuthenticated) {
    const url = new URL('/login', request.url);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
