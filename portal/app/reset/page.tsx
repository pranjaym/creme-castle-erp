import ResetForm from './ResetForm';
import Expired from './Expired';

// Public page opened by the emailed reset link: /reset?token=...&from=kitchen.
// Opening it changes nothing; the token is only used when the form is sent.
export const dynamic = 'force-dynamic';

export default async function ResetPage({ searchParams }: {
  searchParams: Promise<{ token?: string; from?: string }>;
}) {
  const { token, from } = await searchParams;
  const f = from === 'kitchen' ? 'kitchen' : 'portal';
  return (
    <div className="loginwrap">
      <div className="card">
        <span className="brand">Creme Castle ERP</span>
        <span className="sub">Choose a new password</span>
        {token ? <ResetForm token={token} from={f} /> : <Expired from={f} />}
      </div>
    </div>
  );
}
