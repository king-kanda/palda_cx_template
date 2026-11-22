"use client";

import { useActionState } from "react";
import { GoogleSignIn, PasswordField } from "@/components/auth-fields";
import { loginAction, type LoginState } from "./actions";

export function LoginForm({ google, initialError, demo }: { google: boolean; initialError?: string; demo: boolean }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, { error: initialError });

  return (
    <>
      <form action={action} className="space-y-5">
        <div>
          <label htmlFor="email" className="mb-2 block text-sm font-medium">
            Your email
          </label>
          <input id="email" className="input !h-12" name="email" type="email" required placeholder="you@yourbusiness.co.ke" autoComplete="email" />
        </div>
        <div>
          <label htmlFor="password" className="mb-2 block text-sm font-medium">
            Password
          </label>
          <PasswordField />
        </div>
        {state.error ? (
          <p role="alert" aria-live="polite" className="rounded-xl border border-danger-600/30 bg-danger-100 px-3 py-2 text-sm text-danger-600">
            {state.error}
          </p>
        ) : null}
        <button className="btn btn-primary h-12 w-full" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {google ? <GoogleSignIn target="app" /> : null}

      <p className="mt-8 text-center text-sm text-ink-muted">No account yet? Your Palda CX account manager sets one up for you.</p>
      {demo ? (
        <p className="mt-2 text-center text-xs text-ink-subtle">
          Demo: <span className="font-mono">owner@palda.co.ke</span> / <span className="font-mono">owner1234</span>
        </p>
      ) : null}
    </>
  );
}
