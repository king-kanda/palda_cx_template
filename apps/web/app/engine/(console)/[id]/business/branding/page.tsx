import { getEngineCustomer, getSettings, systemPrincipal, withPrincipal } from "@garden/services";
import { requireEngineAdmin } from "@/lib/engine-auth";
import { WorkspaceHeader } from "../../header";
import { BrandForm } from "./brand-form";

export const dynamic = "force-dynamic";

export default async function BrandingPage({ params }: { params: Promise<{ id: string }> }) {
  await requireEngineAdmin();
  const { id } = await params;
  const customer = await getEngineCustomer(id);
  const { brand } = await withPrincipal(systemPrincipal(id, "engine:brand"), (ctx) => getSettings(ctx));

  return (
    <div className="space-y-5">
      <WorkspaceHeader
        customer={customer}
        title="Branding"
        subtitle={`How ${customer.name} looks: their logo and colours appear in their own app, on their public forms and on their invoices.`}
      />
      <BrandForm
        tenantId={id}
        businessName={customer.name}
        initial={{
          logo: brand.logo,
          primary: brand.primary,
          accent: brand.accent,
          website: brand.website,
          tagline: brand.tagline,
          instagram: brand.instagram,
          facebook: brand.facebook,
          tiktok: brand.tiktok,
          linkedin: brand.linkedin,
          email: brand.email,
          phone: brand.phone,
        }}
      />
    </div>
  );
}
