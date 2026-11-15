import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { embeddedSignupReady, graphVersion, metaConfig, whatsappMode } from "@garden/integrations";
import { getSettings, getWhatsappConnection, withPrincipal } from "@garden/services";
import { getSession } from "@/lib/auth";
import { principalOf } from "@/lib/principal";
import { PageHeader, Section } from "@/components/ui";
import { EmbeddedSignup } from "./embedded-signup";

export const dynamic = "force-dynamic";

/**
 * Where the owner connects their own WhatsApp number, inside their own app. Meta's sign-in popup opens from here, so the
 * customer authorises their own account and nothing passes through the Palda team.
 */
export default async function ConnectWhatsappPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "owner") redirect("/integrations");
  const [settings, connection] = await Promise.all([
    withPrincipal(principalOf(session), (ctx) => getSettings(ctx)),
    getWhatsappConnection(session.tenantId),
  ]);
  const meta = metaConfig();

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href="/integrations" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Integrations
      </Link>
      <PageHeader title="Connect WhatsApp" subtitle={`Link your business number so ${settings.agentName} can chat with your customers.`} />

      <Section title="Before you start">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-muted">
          <li>Have the phone with your business WhatsApp number to hand. You may be asked to confirm with a code or by scanning a QR code.</li>
          <li>
            <strong className="text-ink">Already use the WhatsApp Business app on this number?</strong> You can keep using it. Your chats
            stay, replies you send from your phone appear in your inbox, and {settings.agentName} stays quiet in any chat you answer
            yourself. Use the latest version of the app, and open it at least every couple of weeks or the link will pause.
          </li>
          <li>A new number works too. You will be asked to add a payment method to your WhatsApp account during the steps.</li>
        </ul>
      </Section>

      <Section title="Connect">
        {embeddedSignupReady() ? (
          <EmbeddedSignup
            appId={meta.appId}
            configId={meta.configId}
            graphVersion={graphVersion()}
            featureType={process.env.META_ES_FEATURE_TYPE?.trim() || null}
            mock={whatsappMode() === "mock"}
            initial={
              connection && connection.status !== "disconnected"
                ? { displayPhone: connection.displayPhone, verifiedName: connection.verifiedName, mode: connection.mode }
                : null
            }
          />
        ) : (
          <p className="text-sm text-ink-muted">WhatsApp connection isn&apos;t available yet. Please let the Palda team know.</p>
        )}
      </Section>
    </div>
  );
}
