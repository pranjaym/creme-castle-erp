import ForgotForm from './ForgotForm';
import { KITCHEN_URL } from '@/lib/password-reset';

// Public page: ask for a password reset link by email. Reached from "Forgot
// password?" on the portal sign-in page, and from the kitchen app's sign-in
// page with ?from=kitchen (so the person is sent back there afterwards).
export const dynamic = 'force-dynamic';

export default async function ForgotPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  const kitchen = from === 'kitchen';
  return (
    <div className="loginwrap">
      <div className="card">
        <span className="brand">Creme Castle ERP</span>
        <span className="sub">Reset your password</span>
        <ForgotForm from={kitchen ? 'kitchen' : 'portal'} backHref={kitchen ? `${KITCHEN_URL}/login` : '/login'} />
      </div>
    </div>
  );
}
