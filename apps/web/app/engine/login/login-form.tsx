"use client";

import { useActionState } from "react";
import { GoogleSignIn, PasswordField } from "@/components/auth-fields";
import { engineLoginAction, type EngineLoginState } from "./actions";

export function EngineLoginForm({ google, initialError }: { google: boolean; initialError?: string }) {
  const [state, action, pending] = useActionState<EngineLoginState, FormData>(engineLoginAction, { error: initialError });
  return (
    <>
      <form action={action} className="space-y-5">
        <div>
          <label htmlFor="email" className="mb-2 block text-sm font-medium">
            Your email
          </label>
          <input id="email" name="email" type="email" required autoComplete="email" placeholder="you@palda.co.ke" className="input !h-12" />
        </div>
        <div>
          <label htmlFor="password" className="mb-2 block text-sm font-medium">
            Password
          </label>
          <PasswordField />
        </div>
        {state.error ? (
          <p role="alert" className="rounded-xl border border-danger-600/30 bg-danger-100 px-3 py-2 text-sm text-danger-600">
            {state.error}
          </p>
        ) : null}
        <button className="btn btn-primary h-12 w-full" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
      {google ? <GoogleSignIn target="engine" /> : null}
      <p className="mt-8 text-center text-sm text-ink-muted">
        Not on the Palda team? <a href="/login" className="font-medium text-brand-700 hover:underline">Sign in to your business</a>
      </p>
    </>
  );
}
