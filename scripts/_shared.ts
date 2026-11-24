import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

/** Loads .env.local if present (scripts run outside Next, which normally does this). */
export function loadLocalEnv(): void {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // no .env.local: rely on the shell's environment
  }
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} is not set. Add it to .env.local (see .env.example).`);
    process.exit(1);
  }
  return v;
}

export function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Asks for a secret without echoing it to the screen. */
export async function askHidden(question: string): Promise<string> {
  let muted = false;
  const out = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output: out, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}
