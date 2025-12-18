import './globals.css';
import ThemeClientProvider from './ThemeClientProvider';

export const metadata = {
  title: 'Smart Notes',
  description: 'Notes and tasks with reminders',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/favicon.svg',
  },
};

export const viewport = {
  themeColor: '#111827',
};

export default function RootLayout(props: any) {
  const { children } = props;
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="theme-color" content="#111827" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/favicon.svg" />
        <link rel="apple-touch-icon" href="/favicon.svg" />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeClientProvider>{children}</ThemeClientProvider>
      </body>
    </html>
  );
}
