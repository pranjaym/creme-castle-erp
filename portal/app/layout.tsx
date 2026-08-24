import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Creme Castle ERP',
  description: 'Team-facing window onto the spine: dashboards and reports.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
