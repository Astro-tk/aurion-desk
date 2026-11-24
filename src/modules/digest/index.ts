import type { ModuleManifest } from '../types';
const manifest: ModuleManifest = {
  key: 'digest', label: 'Digest', href: '/digest', icon: 'digest', phase: 1, status: 'live',
  capability: 'settings.read',
  description: 'The 18:00 daily email: preview it and see past runs.',
  digest: () => import('./job-failures'),
};
export default manifest;
