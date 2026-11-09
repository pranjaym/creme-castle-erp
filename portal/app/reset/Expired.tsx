// Shown when a reset link has been used, replaced by a newer email, or is past its hour.
export default function Expired({ from }: { from: string }) {
  const kitchen = from === 'kitchen';
  return (
    <div className="center">
      <div className="h-reset">This link has stopped working</div>
      <p className="lede">
        Reset links work once, within 1 hour. This one has been used, or a newer email
        replaced it, or the hour is up.
      </p>
      <a className="primary btnlink" href={kitchen ? '/forgot?from=kitchen' : '/forgot'}>Email me a new link</a>
      <a className="ghostbtn" href={kitchen ? 'https://cremecastle-kitchen.vercel.app/login' : '/login'}>Back to sign in</a>
    </div>
  );
}
