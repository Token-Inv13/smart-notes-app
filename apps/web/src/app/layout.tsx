import './globals.css';
import type { ReactNode } from 'react';
import ThemeClientProvider from './ThemeClientProvider';
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/siteConfig';

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  alternates: {
    canonical: '/',
  },
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    shortcut: '/icons/icon-192.png',
    apple: '/icons/icon-192.png',
  },
  openGraph: {
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: `${SITE_URL}/`,
    siteName: SITE_NAME,
    locale: 'fr_FR',
    type: 'website',
    images: [{ url: '/favicon.svg' }],
  },
  twitter: {
    card: 'summary',
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: ['/favicon.svg'],
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#111827',
  viewportFit: 'cover',
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout(props: RootLayoutProps) {
  const { children } = props;
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeClientProvider>{children}</ThemeClientProvider>
      </body>
    </html>
  );
}
