import type { ModuleManifest } from './types';
import home from './home';
import pipeline from './pipeline';
import inbox from './inbox';
import blueprint from './blueprint';
import scorecard from './scorecard';
import platforms from './platforms';
import digest from './digest';
import settings from './settings';
import analytics from './analytics';
import docs from './docs';
import ai from './ai';
import social from './social';
import experiments from './experiments';
import money from './money';

/**
 * The module registry. It drives the sidebar, the phone bar, the Home cards and the digest.
 * Order here is the order on screen.
 */
export const MODULES: readonly ModuleManifest[] = [
  home,
  inbox,
  pipeline,
  blueprint,
  scorecard,
  platforms,
  digest,
  settings,
  // Phase 2
  analytics,
  docs,
  ai,
  // Phase 3
  social,
  experiments,
  money,
];

export function liveModules(): ModuleManifest[] {
  return MODULES.filter((m) => m.status === 'live');
}
