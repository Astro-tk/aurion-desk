import type { ModuleManifest } from '../types';
const manifest: ModuleManifest = {
  key: 'links', label: 'Bio links', href: '/links', icon: 'analytics', phase: 1, status: 'live',
  capability: 'events.read',
  description: 'Views and clicks on aurioncreative.com/links, by link and by social platform.',
  home: () => import('./home'),
  digest: () => import('./digest'),
};
export default manifest;
