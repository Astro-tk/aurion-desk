import type { ModuleManifest } from '../types';
const manifest: ModuleManifest = {
  key: 'inbox', label: 'Inbox', href: '/inbox', icon: 'inbox', phase: 1, status: 'live',
  capability: 'inbox.read', mobilePrimary: true,
  description: 'Website forms and chatbot leads waiting to be accepted or dismissed.',
  home: () => import('./home'),
  digest: () => import('./digest'),
};
export default manifest;
