// Runs on every request. Two jobs:
//  1. Keep the Supabase auth session cookie fresh (so server components see the
//     logged-in user).
//  2. Gate the app: anyone not signed in is sent to /login, except for /login
//     itself and static assets.
//
// This is a coarse gate (signed in or not). Fine-grained role checks live in the
// pages themselves via requireUser / requireAdmin, so a viewer cannot reach an
// admin page even though the middleware let them past.
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const PUBLIC_PREFIXES = ['/login', '/auth'];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SPINE_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SPINE_SUPABASE_ANON_KEY;
  // If env is not wired yet, do not hard-crash every route; just let it through
  // (the pages will still fail closed because getSessionUser throws without env).
  if (!url || !anon) return response;

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(toSet: Array<{ name: string; value: string; options?: object }>) {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2])
        );
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));

  if (!user && !isPublic) {
    const to = request.nextUrl.clone();
    to.pathname = '/login';
    to.searchParams.set('next', path);
    return NextResponse.redirect(to);
  }

  return response;
}

export const config = {
  // Run on everything except Next internals and obvious static files.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
