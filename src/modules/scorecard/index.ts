import type { ModuleManifest } from '../types';
const manifest: ModuleManifest = {
  key: 'scorecard', label: 'Scorecard', href: '/scorecard', icon: 'scorecard', phase: 1, status: 'live',
  capability: 'scorecard.read',
  description: 'Weekly numbers and December channel targets.',
  home: () => import('./home'),
};
export default manifest;
