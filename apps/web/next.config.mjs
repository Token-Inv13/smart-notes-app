import withPWA from 'next-pwa';
import type { NextConfig } from 'next';

const baseConfig: NextConfig = {
  experimental: {
    appDir: true,
  },
};

const nextConfig: NextConfig = withPWA({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
  runtimeCaching: [
    {
      urlPattern: ({ request }) => request.mode === 'navigate',
      handler: 'NetworkFirst',
      options: {
        cacheName: 'html-cache',
      },
    },
    {
      urlPattern: /^https:\/\/[^/]+\/_next\//,
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: 'next-static-cache',
      },
    },
    {
      urlPattern: /^https?:\/\/[^/]+\/icons\//,
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: 'icons-cache',
      },
    },
  ],
})(baseConfig);

export default nextConfig;
