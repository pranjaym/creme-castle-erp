'use server';

import { redirect } from 'next/navigation';
import { authClient } from '@/lib/supabase/authClient';
import { spine } from '@/lib/supabase/service';

// Sign in with email + password. Accounts are created by an admin (no public
// signup), so a wrong email or password just fails here. On success we also
// confirm the user has an active profile; an auth user with no active profile is
// not allowed in (fail closed).
export async function login(_prev: unknown, formData: FormData): Promise<{ error: string } | void> {
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');
  const next = String(formData.get('next') || '/') || '/';

  if (!email || !password) return { error: 'Enter your email and password.' };

  const supabase = await authClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    return { error: 'Email or password is not correct.' };
  }

  const { data: profile } = await spine()
    .from('profiles')
    .select('active')
    .eq('id', data.user.id)
    .single();

  if (!profile || profile.active === false) {
    await supabase.auth.signOut();
    return { error: 'This account is not active. Ask an admin to enable it.' };
  }

  // Only allow relative paths as the post-login destination (no open redirect).
  const dest = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  redirect(dest);
}

export async function logout() {
  const supabase = await authClient();
  await supabase.auth.signOut();
  redirect('/login');
}
