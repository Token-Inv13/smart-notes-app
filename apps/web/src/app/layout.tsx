import './globals.css';

export const metadata = {
  title: 'Smart Notes',
  description: 'Notes and tasks with reminders',
  manifest: '/manifest.webmanifest',
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
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
