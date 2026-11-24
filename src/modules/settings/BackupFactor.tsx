'use client';

import { useState, useTransition } from 'react';
import { ActionForm, Field } from '@/components/forms';
import { startBackupFactorAction, verifyBackupFactorAction } from './actions';

type Enrolment = { factorId?: string; qr?: string; secret?: string; error?: string };

/** Add a second authenticator (a spare phone, or a password manager that does TOTP). */
export function BackupFactor() {
  const [e, setE] = useState<Enrolment | null>(null);
  const [pending, start] = useTransition();
  if (!e?.factorId) {
    return (
      <div className="space-y-2">
        {e?.error ? <p role="alert" className="text-sm text-danger">{e.error}</p> : null}
        <button type="button" className="btn" disabled={pending} onClick={() => start(async () => setE(await startBackupFactorAction()))}>
          {pending ? 'Preparing' : 'Add a backup authenticator'}
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-2 text-sm">
      <p className="text-ink-2">Scan this with the second device or app, then enter its code.</p>
      {e.qr ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={e.qr} alt="QR code for the backup authenticator" width={160} height={160} className="rounded bg-white p-2" />
      ) : null}
      <code className="block font-mono text-xs break-all">{e.secret}</code>
      <ActionForm action={verifyBackupFactorAction} submitLabel="Verify and add" submitClass="btn">
        <input type="hidden" name="factorId" value={e.factorId} />
        <Field label="6-digit code" htmlFor="backup_code">
          <input className="input num w-40" id="backup_code" name="code" inputMode="numeric" autoComplete="one-time-code" />
        </Field>
      </ActionForm>
    </div>
  );
}
