import './globals.css';
import type { ReactNode } from 'react';
import ThemeClientProvider from './ThemeClientProvider';

export const metadata = {
  metadataBase: new URL('https://app.tachesnotes.com'),
  title: 'Smart Notes',
  description: 'Notes and tasks with reminders',
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
    title: 'Smart Notes',
    description: 'Notes and tasks with reminders',
    url: 'https://app.tachesnotes.com/',
    siteName: 'Smart Notes',
    locale: 'fr_FR',
    type: 'website',
    images: [{ url: '/favicon.svg' }],
  },
  twitter: {
    card: 'summary',
    title: 'Smart Notes',
    description: 'Notes and tasks with reminders',
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
