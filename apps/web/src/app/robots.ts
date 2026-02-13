import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
    },
    sitemap: 'https://app.tachesnotes.com/sitemap.xml',
    host: 'https://app.tachesnotes.com',
  };
}
