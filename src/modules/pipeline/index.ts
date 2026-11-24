import type { ModuleManifest } from '../types';
const manifest: ModuleManifest = {
  key: 'pipeline', label: 'Pipeline', href: '/pipeline', icon: 'pipeline', phase: 1, status: 'live',
  capability: 'pipeline.read', mobilePrimary: true,
  description: 'Leads by stage, with contacts, consent, activities and history.',
  home: () => import('./home'),
  digest: () => import('./digest'),
};
export default manifest;
