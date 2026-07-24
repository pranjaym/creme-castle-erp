import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Creme Castle Kitchen',
  description: 'Intermediates logbook and D2C reconciliation, on the spine.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="wrap">{children}</div>
      </body>
    </html>
  );
}
