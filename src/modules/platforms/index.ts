import type { ModuleManifest } from '../types';
const manifest: ModuleManifest = {
  key: 'platforms', label: 'Platforms', href: '/platforms', icon: 'platforms', phase: 1, status: 'live',
  capability: 'platforms.read',
  description: 'Every tool Aurion pays for or relies on, with costs and renewals.',
  home: () => import('./home'),
  digest: () => import('./digest'),
};
export default manifest;
