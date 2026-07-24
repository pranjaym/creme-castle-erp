// Cookie-bound Supabase client for the CURRENT request. Uses the publishable
// (anon) key. This is how we know WHO is logged in. All privileged data reads go
// through the service-role client instead (service.ts); this one is only for auth.
import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

export async function authClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SPINE_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SPINE_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error('NEXT_PUBLIC_SPINE_SUPABASE_URL / _ANON_KEY missing');
  }
  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(toSet: Array<{ name: string; value: string; options?: object }>) {
        // In a Server Component the cookie store is read only; the middleware is
        // what actually refreshes the session cookie, so swallowing here is safe.
        try {
          toSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options as Parameters<typeof cookieStore.set>[2])
          );
        } catch {
          // called from a Server Component: ignore, middleware handles refresh.
        }
      },
    },
  });
}
