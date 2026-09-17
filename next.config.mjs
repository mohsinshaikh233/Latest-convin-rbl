import { BASE_PATH } from './src/lib/basepath.mjs';

const nextConfig = {
  basePath: BASE_PATH,

  async redirects() {
    return [
      {
        source: '/',
        destination: BASE_PATH,
        basePath: false,
        permanent: false,
      },
    ];
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }],
      },
    ];
  },
};

export default nextConfig;
