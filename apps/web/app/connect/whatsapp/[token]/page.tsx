import { notFound } from "next/navigation";
import { embeddedSignupReady, graphVersion, metaConfig, whatsappMode } from "@garden/integrations";
import { getSettings, getWhatsappConnection, systemPrincipal, verifyWhatsappConnectToken, withPrincipal } from "@garden/services";
import { BrandMark, BrandStyle } from "@/components/brand";
import { EmbeddedSignup } from "./embedded-signup";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connect WhatsApp", robots: { index: false, follow: false } };

/**
 * The page a customer opens (from a link the Palda team sends) to connect their own WhatsApp number. The link is signed, names
 * one business and expires; it wears that business's brand. Nothing here needs a Palda sign-in.
 */
export default async function ConnectWhatsappPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const verified = verifyWhatsappConnectToken(token);
  if (!verified) {
    return (
      <main className="grid min-h-screen place-items-center px-4 py-12">
        <div className="card w-full max-w-lg p-8 text-center">
          <h1 className="text-xl font-semibold">This link has expired</h1>
          <p className="mt-2 text-sm text-ink-muted">Ask the Palda team for a new link to connect your WhatsApp number.</p>
        </div>
      </main>
    );
  }

  let settings: Awaited<ReturnType<typeof getSettings>>;
  try {
    settings = await withPrincipal(systemPrincipal(verified.tenantId, "whatsapp-connect"), (ctx) => getSettings(ctx));
  } catch {
    notFound();
  }
  const connection = await getWhatsappConnection(verified.tenantId);
  const meta = metaConfig();
  const mock = whatsappMode() === "mock";
  const ready = embeddedSignupReady();

  return (
    <main className="grid min-h-screen place-items-center px-4 py-12">
      <BrandStyle brand={settings.brand} />
      <div className="w-full max-w-xl space-y-5">
        <div className="text-center">
          <BrandMark brand={settings.brand} className="mx-auto mb-3 size-14" />
          <h1 className="text-2xl font-bold">Connect WhatsApp for {settings.tenant.name}</h1>
          <p className="mt-1 text-sm text-ink-muted">Link your business number so {settings.agentName} can chat with your customers.</p>
        </div>

        <section className="card p-5">
          <h2 className="mb-3 text-lg font-semibold">Before you start</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-muted">
            <li>Have the phone with your business WhatsApp number to hand. You may be asked to confirm with a code or by scanning a QR code.</li>
            <li>
              <strong className="text-ink">Already use the WhatsApp Business app on this number?</strong> You can keep using it. Your
              chats stay, replies you send from your phone appear in your inbox, and the assistant stays quiet in any chat you answer
              yourself. Use the latest version of the app, and open it at least every couple of weeks or the link will pause.
            </li>
            <li>A new number works too. You will be asked to add a payment method to your WhatsApp account during the steps.</li>
          </ul>
        </section>

        <section className="card p-5">
          {ready ? (
            <EmbeddedSignup
              token={token}
              appId={meta.appId}
              configId={meta.configId}
              graphVersion={graphVersion()}
              featureType={process.env.META_ES_FEATURE_TYPE?.trim() || null}
              mock={mock}
              initial={
                connection && connection.status !== "disconnected"
                  ? { displayPhone: connection.displayPhone, verifiedName: connection.verifiedName, mode: connection.mode }
                  : null
              }
            />
          ) : (
            <p className="text-sm text-ink-muted">WhatsApp connection isn&apos;t set up on this server yet. Please let the Palda team know.</p>
          )}
        </section>

        <p className="text-center text-xs text-ink-subtle">This link is private to {settings.tenant.name} and stops working after a few days.</p>
      </div>
    </main>
  );
}
