'use client';

import { useActionState, useState, useTransition } from 'react';
import { startEnrolmentAction, verifyCodeAction, type FormState } from './actions';

type Enrolment = { factorId?: string; qr?: string; secret?: string; error?: string };

export function TwoFactorForm({ enrolled, next }: { enrolled: boolean; next?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(verifyCodeAction, {});
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [starting, startTransition] = useTransition();

  if (!enrolled && !enrolment?.factorId) {
    return (
      <div className="space-y-3 text-sm text-ink-2">
        <p>
          Desk asks for a second step every time you sign in. Install Google Authenticator or Microsoft Authenticator on your phone, then set it up
          here.
        </p>
        {enrolment?.error ? (
          <p role="alert" className="text-danger">
            {enrolment.error}
          </p>
        ) : null}
        <button
          type="button"
          className="btn-primary w-full"
          disabled={starting}
          onClick={() => startTransition(async () => setEnrolment(await startEnrolmentAction()))}
        >
          {starting ? 'Preparing' : 'Set up authenticator app'}
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3" noValidate>
      {enrolment?.factorId ? (
        <div className="space-y-2 text-sm text-ink-2">
          <p>In your authenticator app, add an account and scan this code.</p>
          {enrolment.qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={enrolment.qr} alt="QR code for your authenticator app" width={180} height={180} className="rounded bg-white p-2" />
          ) : null}
          <p>Cannot scan it? Type this key into the app instead:</p>
          <code className="block rounded bg-surface-2 p-2 font-mono text-xs break-all text-ink">{enrolment.secret}</code>
          <input type="hidden" name="factorId" value={enrolment.factorId} />
          <input type="hidden" name="enrolling" value="1" />
        </div>
      ) : null}
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <div>
        <label className="label" htmlFor="code">
          6-digit code
        </label>
        <input
          className="input num tracking-widest"
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          required
          autoFocus
        />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? 'Checking' : 'Verify'}
      </button>
    </form>
  );
}
