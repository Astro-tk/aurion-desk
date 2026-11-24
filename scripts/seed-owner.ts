/**
 * Creates the owner account (or updates its password), and adds it to desk.members.
 *
 *   npm run seed:owner -- --email you@aurioncreative.com --name "Your Name"
 *   npm run seed:owner -- --email you@aurioncreative.com --reset-2fa
 *
 * The password is asked for on screen and never echoed or stored anywhere else.
 * --reset-2fa removes the authenticator factors (for a lost phone); you enrol again at next sign-in.
 */
import { createClient } from '@supabase/supabase-js';
import { passwordSchema } from '../src/lib/auth/password';
import { argValue, askHidden, loadLocalEnv, requireEnv } from './_shared';

loadLocalEnv();

async function main(): Promise<void> {
  const email = argValue('--email')?.trim().toLowerCase();
  const name = argValue('--name')?.trim();
  const resetMfa = process.argv.includes('--reset-2fa');
  if (!email) throw new Error('Pass --email you@example.com');

  const owners = requireEnv('OWNER_EMAILS')
    .split(',')
    .map((e) => e.trim().toLowerCase());
  if (!owners.includes(email)) throw new Error(`${email} is not in OWNER_EMAILS, so it could never sign in. Add it there first.`);

  const admin = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const desk = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    db: { schema: 'desk' },
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-desk-actor': 'system' } },
  });

  // Find an existing user with this email.
  let userId: string | undefined;
  for (let page = 1; page < 50 && !userId; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id;
    if (data.users.length < 200) break;
  }

  if (resetMfa) {
    if (!userId) throw new Error('No such user.');
    const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
    if (error) throw error;
    for (const f of data.factors) await admin.auth.admin.mfa.deleteFactor({ userId, id: f.id });
    console.log(`Removed ${data.factors.length} two-factor method(s). Sign in and enrol a new authenticator.`);
    return;
  }

  const password = await askHidden('New password (at least 14 characters, hidden): ');
  const check = passwordSchema(email).safeParse(password);
  if (!check.success) throw new Error(check.error.issues.map((i) => i.message).join(' '));
  const again = await askHidden('Type it again: ');
  if (again !== password) throw new Error('The two passwords do not match.');

  if (userId) {
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) throw error;
    console.log('Existing account found: password updated.');
  } else {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    userId = data.user.id;
    console.log('Account created.');
  }

  const { error: memberError } = await desk
    .from('members')
    .upsert({ user_id: userId, email, display_name: name ?? email.split('@')[0], role: 'owner' }, { onConflict: 'user_id' });
  if (memberError) throw memberError;

  console.log(`\n${email} is an owner of Aurion Desk.`);
  console.log('Next: open Desk, sign in, and set up your authenticator app when asked.');
}

main().catch((err: unknown) => {
  console.error(`\nStopped: ${(err as Error).message}`);
  process.exitCode = 1;
});
