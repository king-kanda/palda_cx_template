"use client";

import { useActionState } from "react";
import { LogoMark } from "@/components/ui";
import { engineLoginAction, type EngineLoginState } from "./actions";

const initial: EngineLoginState = {};

export default function EngineLoginPage() {
  const [state, action, pending] = useActionState(engineLoginAction, initial);
  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4 py-12">
      <div className="card w-full max-w-sm p-7">
        <div className="flex items-center gap-2">
          <LogoMark className="size-7 text-brand-800" />
          <span className="text-[1.1875rem] font-bold tracking-tight">palda cx</span>
          <span className="rounded-md bg-lime-400 px-1.5 py-0.5 font-mono text-[0.6875rem] font-medium uppercase tracking-wider text-brand-900">
            engine
          </span>
        </div>
        <h1 className="mt-6 text-2xl font-semibold">Team sign in</h1>
        <p className="mb-5 mt-1 text-sm text-ink-muted">For the Palda CX team. Customers sign in on the main page.</p>
        <form action={action} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
              Email
            </label>
            <input id="email" name="email" type="email" required autoComplete="email" className="input" />
          </div>
          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
              Password
            </label>
            <input id="password" name="password" type="password" required autoComplete="current-password" className="input" />
          </div>
          {state.error ? (
            <p role="alert" className="rounded-xl border border-danger-600/30 bg-danger-100 px-3 py-2 text-sm text-danger-600">
              {state.error}
            </p>
          ) : null}
          <button className="btn btn-primary h-11 w-full" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
