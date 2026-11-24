import type { ModuleManifest } from '../types';
const manifest: ModuleManifest = {
  key: 'blueprint', label: 'Blueprint', href: '/blueprint', icon: 'blueprint', phase: 1, status: 'live',
  capability: 'blueprint.read', mobilePrimary: true,
  description: 'The December Execution Blueprint as a live checklist.',
  home: () => import('./home'),
  digest: () => import('./digest'),
};
export default manifest;
