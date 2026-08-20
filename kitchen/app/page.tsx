// There is no launcher page. Following the OMS pattern, every management
// screen lives inside one shell with permanent navigation, and "home" is the
// first page in it (Today). A tablet goes straight to its own department.
import { redirect } from 'next/navigation';
import { requireKitchenUser, homeFor } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await requireKitchenUser();
  redirect(homeFor(user));
}
