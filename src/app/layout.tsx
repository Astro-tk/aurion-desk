import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Aurion Desk', template: '%s | Aurion Desk' },
  description: 'Aurion Creative private operating centre.',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: 'strict-origin-when-cross-origin',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1F2A2E',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Reading cookies makes every page render per request, which the CSP nonce needs.
  const theme = (await cookies()).get('desk_theme')?.value === 'light' ? 'theme-light' : 'theme-dark';
  return (
    <html lang="en-ZA" className={theme}>
      <body>{children}</body>
    </html>
  );
}
