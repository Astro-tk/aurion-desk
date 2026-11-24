/**
 * Security headers. Pages get a per-request nonce CSP from src/proxy.ts; everything else
 * (API routes, static files) gets the fixed headers from next.config.ts.
 */

export function buildPageCsp(nonce: string, isDev: boolean): string {
  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? ` 'unsafe-eval'` : ''}`,
    // Dev server injects styles without a nonce; production uses only the compiled stylesheet.
    isDev ? `style-src 'self' 'unsafe-inline'` : `style-src 'self' 'nonce-${nonce}'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `frame-src 'none'`,
    `worker-src 'self'`,
    `manifest-src 'self'`,
  ];
  if (!isDev) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

/** For JSON API responses and anything that is not a page. */
export const API_CSP = `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;

export const COMMON_SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
];
