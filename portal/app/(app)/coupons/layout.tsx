// Every coupon screen renders inside .cx so its status colours and tables are
// scoped to this module (F56: an unscoped class once flattened the daily pages).
import { redirect } from 'next/navigation';
import { requireUser, couponPerms } from '@/lib/session';

export default async function CouponsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (!couponPerms(user).view) redirect('/');
  return <div className="cx">{children}</div>;
}
