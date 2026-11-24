import { MODULES } from '../registry';
import type { DigestProvider } from '../types';

/** Every live module that contributes to the digest, in registry order. */
export async function digestProviders(): Promise<Array<{ module: string; provider: DigestProvider }>> {
  const live = MODULES.filter((m) => m.status === 'live' && m.digest);
  return Promise.all(live.map(async (m) => ({ module: m.key, provider: (await m.digest!()).default })));
}
