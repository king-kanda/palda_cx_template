import type { CustomerStatus } from "@garden/services";

export function CustomerStatusPill({ status }: { status: CustomerStatus }) {
  const tone =
    status === "active"
      ? "bg-success-100 text-success-600"
      : status === "suspended"
        ? "bg-danger-100 text-danger-600"
        : "bg-warning-100 text-warning-600";
  const label = status === "active" ? "Live" : status === "suspended" ? "Suspended" : "In setup";
  return <span className={`pill ${tone}`}>{label}</span>;
}
