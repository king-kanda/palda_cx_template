"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

const initial: LoginState = {};

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, initial);

  return (
    <main className="min-h-screen grid place-items-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-[#c2410c] text-2xl">
            🌿
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Garden Booking OS</h1>
          <p className="mt-1 text-sm text-[#78716c]">
            Sign in to your workspace. Wambo is waiting.
          </p>
        </div>

        <form action={action} className="card p-6 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#78716c]">
              Workspace slug <span className="font-normal normal-case">(optional)</span>
            </label>
            <input className="input" name="slug" placeholder="palda" autoComplete="organization" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#78716c]">
              Email
            </label>
            <input
              className="input"
              name="email"
              type="email"
              required
              placeholder="owner@palda.co.ke"
              autoComplete="email"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-[#78716c]">
              Password
            </label>
            <input
              className="input"
              name="password"
              type="password"
              required
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>
          {state.error ? (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{state.error}</p>
          ) : null}
          <button className="btn btn-primary w-full" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </button>
          <p className="text-center text-xs text-[#78716c]">
            Demo owner: <span className="font-mono">owner@palda.co.ke</span> /{" "}
            <span className="font-mono">owner1234</span>
          </p>
        </form>
      </div>
    </main>
  );
}
