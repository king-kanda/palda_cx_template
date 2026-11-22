import { redirect } from "next/navigation";
import { googleSignInMockAllowed } from "@garden/integrations";
import { AuthShell } from "@/components/auth-shell";

export const dynamic = "force-dynamic";

/**
 * Local test mode only: stands in for Google's account picker so "Continue with Google" can be tried without a Google client.
 * Refused on any https deployment (see googleSignInMockAllowed).
 */
export default async function GoogleTestPicker({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (!googleSignInMockAllowed()) redirect("/login");
  const { state = "" } = await searchParams;
  return (
    <AuthShell kicker="Test mode" headline="This stands in for Google on a local install.">
      <h1 className="mt-6 text-[1.75rem] font-semibold leading-tight">Choose an account</h1>
      <p className="mb-7 mt-1.5 text-sm text-ink-muted">Enter the Google email to sign in as. Real Google is used once Apps mode is Live.</p>
      <form action="/auth/google/callback" method="get" className="space-y-5">
        <input type="hidden" name="state" value={state} />
        <div>
          <label htmlFor="code" className="mb-2 block text-sm font-medium">
            Google email
          </label>
          <input id="code" name="email" type="email" required className="input !h-12" placeholder="owner@palda.co.ke" />
        </div>
        <button className="btn btn-primary h-12 w-full">Continue</button>
      </form>
    </AuthShell>
  );
}
