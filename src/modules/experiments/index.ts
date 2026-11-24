import type { ModuleManifest } from '../types';
// Phase 3: not built yet. See README "How Phase 2 and 3 fit".
const manifest: ModuleManifest = {
  key: 'experiments', label: 'Experiments', href: '/experiments', icon: 'experiments', phase: 3, status: 'later',
  description: 'A/B tests on outreach scripts.',
};
export default manifest;
