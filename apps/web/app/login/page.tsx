import { googleSignInAvailable } from "@garden/integrations";
import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

/** Business owners and staff sign in here. Accounts are created by the Palda CX team; there is no public sign-up. */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  // The demo login is only shown on a local install, never on a public https deployment.
  const local = !(process.env.APP_URL ?? "http://localhost:3000").startsWith("https://");
  return (
    <AuthShell kicker="Palda CX" headline="Bookings, payments and WhatsApp, run from one place.">
      <h1 className="mt-6 text-[1.75rem] font-semibold leading-tight">Sign in</h1>
      <p className="mb-7 mt-1.5 text-sm text-ink-muted">Welcome back.</p>
      <LoginForm google={googleSignInAvailable()} initialError={error?.slice(0, 200)} demo={local} />
    </AuthShell>
  );
}
