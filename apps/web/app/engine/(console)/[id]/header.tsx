import Link from "next/link";
import { readinessOf, type CustomerSummary } from "@garden/services";
import { PageHeader } from "../../components/ui";

/** The top-right call to action: roll out when ready, resume setup when not, nothing once live. */
function Cta({ customer }: { customer: CustomerSummary }) {
  if (customer.status === "setup") {
    const missing = readinessOf(customer).filter((c) => c.required && !c.ok);
    return (
      <Link href={`/engine/${customer.id}/rollout`} className="block rounded-2xl bg-brand-800 px-6 py-3 text-white hover:bg-brand-700">
        <span className="block text-[1rem] font-semibold">{missing.length === 0 ? "Roll out →" : "Resume setup →"}</span>
        <span className="block text-xs text-white/80">
          {missing.length === 0 ? "Everything required is done." : `${missing.length} required item${missing.length > 1 ? "s" : ""} left.`}
        </span>
      </Link>
    );
  }
  if (customer.status === "suspended") {
    return (
      <Link href={`/engine/${customer.id}/rollout`} className="btn btn-secondary h-11 px-5">
        Reactivate…
      </Link>
    );
  }
  return null;
}

/** Page header for every page inside a customer's workspace. */
export function WorkspaceHeader({
  customer,
  title,
  subtitle,
  action,
}: {
  customer: CustomerSummary;
  title: string;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <PageHeader
      crumbs={[{ label: "Customers", href: "/engine/customers" }, { label: customer.slug }]}
      title={title}
      subtitle={subtitle}
      action={action ?? <Cta customer={customer} />}
    />
  );
}
