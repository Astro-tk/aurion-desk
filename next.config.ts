import type { NextConfig } from 'next';
import { API_CSP, COMMON_SECURITY_HEADERS } from './src/lib/security-headers';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // This folder is the project root (a stray package-lock.json higher up must not be used).
  turbopack: { root: process.cwd() },
  reactStrictMode: true,
  typedRoutes: false,
  experimental: {
    serverActions: {
      // Next already refuses server-action posts whose Origin is not Desk's own host.
      bodySizeLimit: '6mb', // CSV and blueprint imports
    },
  },
  async headers() {
    return [
      // Every response, pages included.
      { source: '/:path*', headers: [...COMMON_SECURITY_HEADERS] },
      // API routes are JSON: lock them down completely. Pages get a nonce CSP from src/proxy.ts.
      { source: '/api/:path*', headers: [{ key: 'Content-Security-Policy', value: API_CSP }, { key: 'Cache-Control', value: 'no-store' }] },
    ];
  },
};

export default nextConfig;
