import withPWA from 'next-pwa';

const baseConfig = {
  turbopack: {},
};

const nextConfig = withPWA({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
  swSrc: 'src/sw.ts',
})(baseConfig);

export default nextConfig;
