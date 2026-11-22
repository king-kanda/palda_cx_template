import { googleSignInAvailable } from "@garden/integrations";
import { AuthShell } from "@/components/auth-shell";
import { EngineLoginForm } from "./login-form";

export const dynamic = "force-dynamic";

/** The Palda CX team signs in to the Engine here. */
export default async function EngineLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <AuthShell
      kicker="Palda CX Engine"
      headline="Set up every customer, their agent and their apps."
      badge={
        <span className="rounded-md bg-lime-400 px-1.5 py-0.5 font-mono text-[0.6875rem] font-medium uppercase tracking-wider text-brand-900">
          engine
        </span>
      }
    >
      <h1 className="mt-6 text-[1.75rem] font-semibold leading-tight">Team sign in</h1>
      <p className="mb-7 mt-1.5 text-sm text-ink-muted">For the Palda CX team.</p>
      <EngineLoginForm google={googleSignInAvailable()} initialError={error?.slice(0, 200)} />
    </AuthShell>
  );
}
