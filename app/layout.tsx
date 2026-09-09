import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import LoginGate from './login-gate';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Room 311 · Current',
  description: 'Electricity payments and roommate turns for Room 311.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Room 311', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = { themeColor: '#0B0D10' };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <LoginGate>{children}</LoginGate>
      </body>
    </html>
  );
}
