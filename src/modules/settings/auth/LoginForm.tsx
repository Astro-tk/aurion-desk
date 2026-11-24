'use client';

import { useActionState } from 'react';
import { signInAction, type FormState } from './actions';

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(signInAction, {});
  return (
    <form action={action} className="space-y-3" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input className="input" id="email" name="email" type="email" autoComplete="username" required inputMode="email" />
      </div>
      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? 'Checking' : 'Continue'}
      </button>
    </form>
  );
}
