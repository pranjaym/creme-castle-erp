// Runs on every request (same two jobs as the ERP portal's middleware):
//  1. keep the Supabase auth session cookie fresh;
//  2. coarse gate: not signed in -> /login (fine-grained role checks live in
//     the pages via requireKitchenUser / requireRoles / mayUseDept).
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const PUBLIC_PREFIXES = ['/login', '/auth'];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SPINE_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SPINE_SUPABASE_ANON_KEY;
  if (!url || !anon) return response; // pages still fail closed without env

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
  matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts/|brand/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|otf|woff2?)$).*)'],
};
