import type { ModuleManifest } from '../types';
const manifest: ModuleManifest = {
  key: 'settings', label: 'Settings', href: '/settings', icon: 'settings', phase: 1, status: 'live',
  capability: 'settings.read',
  description: 'Lists, targets, profile, two-factor, data export and the danger zone.',
};
export default manifest;
