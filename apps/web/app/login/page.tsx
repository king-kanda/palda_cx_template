"use client";

import Link from "next/link";
import { useActionState } from "react";
import { CheckCircle2 } from "lucide-react";
import { LogoMark } from "@/components/ui";
import { loginAction, type LoginState } from "./actions";

const initial: LoginState = {};

const POINTS = [
  "Bookings, holds and payments in one calendar",
  "Wambo answers WhatsApp inquiries around the clock",
  "Invoices, M-Pesa receipts and expenses reconciled for you",
];

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, initial);

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col bg-surface px-6 py-8 sm:px-12">
        <div className="flex items-center gap-2">
          <LogoMark />
          <span className="text-lg font-bold tracking-tight">PALDA CX</span>
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="text-2xl font-bold">Sign in</h1>
          <p className="mb-6 mt-1 text-sm text-ink-muted">Welcome back. Wambo is waiting.</p>

          <form action={action} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                className="input"
                name="email"
                type="email"
                required
                placeholder="you@yourbusiness.co.ke"
                autoComplete="email"
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
                Password
              </label>
              <input
                id="password"
                className="input"
                name="password"
                type="password"
                required
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>
            {state.error ? (
              <p
                role="alert"
                aria-live="polite"
                className="rounded-xl border border-danger-600/30 bg-danger-100 px-3 py-2 text-sm text-danger-600"
              >
                {state.error}
              </p>
            ) : null}
            <button className="btn btn-primary h-11 w-full" disabled={pending}>
              {pending ? "Signing in…" : "Sign in"}
            </button>
            <p className="text-center text-sm text-ink-muted">
              New business?{" "}
              <Link href="/onboarding" className="font-semibold text-brand-700 hover:underline">
                Set up your business
              </Link>
            </p>
            <p className="text-center text-sm text-ink-muted">
              Demo owner: <span className="font-mono">owner@palda.co.ke</span> /{" "}
              <span className="font-mono">owner1234</span>
            </p>
          </form>
        </div>
      </div>

      <div className="relative hidden overflow-hidden bg-brand-800 p-12 text-white lg:flex lg:flex-col lg:justify-end">
        <LogoMark className="pointer-events-none absolute -right-24 -top-24 size-[28rem] text-white/5" />
        <h2 className="max-w-md text-3xl font-bold leading-tight">Run every booking from one place.</h2>
        <ul className="mt-6 space-y-3">
          {POINTS.map((p) => (
            <li key={p} className="flex gap-3 text-white/80">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-lime-400" />
              {p}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
