'use client';

import { useActionState, useEffect, useRef, type ReactNode } from 'react';

export type ClientActionResult =
  | { ok: true; message?: string; data?: unknown }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

type ServerAction = (prev: ClientActionResult, fd: FormData) => Promise<ClientActionResult>;

/**
 * A form bound to a server action, showing the result in plain words.
 * resetOnSuccess clears the inputs after a successful save (quick add, "log another").
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel = 'Saving',
  className = 'space-y-3',
  resetOnSuccess = false,
  submitClass = 'btn-primary',
  confirm,
}: {
  action: ServerAction;
  children: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  className?: string;
  resetOnSuccess?: boolean;
  submitClass?: string;
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState<ClientActionResult, FormData>(action, { ok: true });
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnSuccess && state.ok && state.message) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      action={formAction}
      className={className}
      noValidate
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      {!state.ok ? (
        <div role="alert" className="text-sm text-danger">
          <p>{state.error}</p>
          {state.fieldErrors ? (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {Object.entries(state.fieldErrors).map(([k, v]) => (
                <li key={k}>{v}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : state.message ? (
        <p role="status" className="text-sm text-ink-2">
          {state.message}
        </p>
      ) : null}
      <button className={submitClass} disabled={pending}>
        {pending ? pendingLabel : submitLabel}
      </button>
    </form>
  );
}

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-xs text-ink-3">{hint}</p> : null}
    </div>
  );
}

/** Submits its form as soon as the select changes (stage changes on the board, without extra taps). */
export function AutoSubmitSelect({ name, defaultValue, options, label }: { name: string; defaultValue: string; options: Array<{ value: string; label: string }>; label: string }) {
  return (
    <select
      name={name}
      defaultValue={defaultValue}
      aria-label={label}
      className="input min-h-8 py-1 text-xs"
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
