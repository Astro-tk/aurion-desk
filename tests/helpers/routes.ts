import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Every page and API route in src/app, as URL paths (dynamic segments filled with "x"). */
export function allAppRoutes(): Array<{ path: string; type: 'page' | 'api'; file: string }> {
  const root = join(process.cwd(), 'src', 'app');
  const out: Array<{ path: string; type: 'page' | 'api'; file: string }> = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      const isPage = /^page\.tsx?$/.test(name);
      const isRoute = /^route\.tsx?$/.test(name);
      if (!isPage && !isRoute) continue;
      const segments = relative(root, dir)
        .split(sep)
        .filter(Boolean)
        .filter((s) => !/^\(.*\)$/.test(s)) // route groups do not appear in URLs
        .map((s) => (/^\[.*\]$/.test(s) ? 'x' : s));
      out.push({ path: `/${segments.join('/')}`, type: isRoute && segments[0] === 'api' ? 'api' : 'page', file: relative(process.cwd(), full) });
    }
  };
  walk(root);
  return out;
}
