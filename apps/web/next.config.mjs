import withPWA from 'next-pwa';

const baseConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
};

const nextConfig = withPWA({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
  swSrc: 'src/sw.ts',
})(baseConfig);

export default nextConfig;
