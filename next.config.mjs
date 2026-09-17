import { BASE_PATH } from './src/lib/basepath.mjs';

const nextConfig = {
  basePath: BASE_PATH,

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
