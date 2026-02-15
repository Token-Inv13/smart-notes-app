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
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/favicon.svg',
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
  themeColor: '#111827',
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout(props: RootLayoutProps) {
  const { children } = props;
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeClientProvider>{children}</ThemeClientProvider>
      </body>
    </html>
  );
}
