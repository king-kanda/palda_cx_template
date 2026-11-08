export const CUSTOMER_SCOPES = [
  "knowledge:read",
  "bookings:read_own",
  "bookings:write_own",
  "payments:request_own",
  "reviews:write_own",
  "handoff:create",
] as const;

export const SYSTEM_SCOPES = [
  "knowledge:read",
  "bookings:read",
  "bookings:write",
  "payments:read",
  "payments:write",
  "invoices:read",
  "invoices:write",
  "reminders:write",
  "reports:read",
  "approvals:read",
  "customers:read",
  "messages:send",
] as const;

export type Principal =
  | {
      type: "customer";
      tenantId: string;
      customerId: string;
      phoneE164: string;
      scopes: string[];
    }
  | {
      type: "staff";
      tenantId: string;
      userId: string;
      role: "owner" | "staff";
      scopes: string[];
    }
  | {
      type: "system";
      tenantId: string;
      scopes: string[];
      label?: string;
    };

export function systemPrincipal(
  tenantId: string,
  label = "system",
  scopes: string[] = ["*"],
): Principal {
  return { type: "system", tenantId, scopes, label };
}

export function staffPrincipal(
  tenantId: string,
  userId: string,
  role: "owner" | "staff" = "staff",
): Principal {
  return { type: "staff", tenantId, userId, role, scopes: ["*"] };
}

export function customerPrincipal(input: {
  tenantId: string;
  customerId: string;
  phoneE164: string;
}): Principal {
  return {
    type: "customer",
    tenantId: input.tenantId,
    customerId: input.customerId,
    phoneE164: input.phoneE164,
    scopes: [...CUSTOMER_SCOPES],
  };
}


export type BookingStatus =
  | "inquiry"
  | "hold"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show";

export const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ["hold", "confirmed"];
export const BLOCKING_BOOKING_STATUSES: BookingStatus[] = ["hold", "confirmed"];

export class ServiceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class ValidationError extends ServiceError {
  constructor(message: string, details?: unknown) {
    super("VALIDATION", message, 400, details);
    this.name = "ValidationError";
  }
}

export class ForbiddenError extends ServiceError {
  constructor(message = "You are not allowed to do that.") {
    super("FORBIDDEN", message, 403);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends ServiceError {
  constructor(entity: string, id?: string) {
    super("NOT_FOUND", `${entity}${id ? ` ${id}` : ""} not found.`, 404);
    this.name = "NotFoundError";
  }
}

export class SlotUnavailableError extends ServiceError {
  constructor(message = "That slot is no longer available.") {
    super("SLOT_UNAVAILABLE", message, 409);
    this.name = "SlotUnavailableError";
  }
}

export class ConflictError extends ServiceError {
  constructor(message: string) {
    super("CONFLICT", message, 409);
    this.name = "ConflictError";
  }
}

export class PolicyError extends ServiceError {
  constructor(message: string, details?: unknown) {
    super("POLICY", message, 422, details);
    this.name = "PolicyError";
  }
}

export function hasScope(principal: Principal, scope: string): boolean {
  return principal.scopes.includes("*") || principal.scopes.includes(scope);
}

export function requireScope(principal: Principal, scope: string): void {
  if (!hasScope(principal, scope)) {
    throw new ForbiddenError(`Missing scope: ${scope}`);
  }
}

export function requireStaff(principal: Principal): void {
  if (principal.type !== "staff") throw new ForbiddenError("Staff access required.");
}

export function requireOwner(principal: Principal): void {
  requireStaff(principal);
  if (principal.type === "staff" && principal.role !== "owner") {
    throw new ForbiddenError("Owner access required.");
  }
}

export function actorOf(principal: Principal): string {
  switch (principal.type) {
    case "customer":
      return `customer:${principal.customerId}`;
    case "staff":
      return `staff:${principal.userId}`;
    case "system":
      return `system:${principal.label ?? "agent"}`;
  }
}

/** WhatsApp numbers are normalised to +2547XXXXXXXX / +2541XXXXXXXX. */
export function normalisePhone(input: string): string {
  const digits = input.replace(/[^\d+]/g, "");
  if (digits.startsWith("+254")) return digits;
  if (digits.startsWith("254")) return `+${digits}`;
  if (digits.startsWith("0")) return `+254${digits.slice(1)}`;
  if (digits.startsWith("+")) return digits;
  return `+254${digits}`;
}

export function kes(amount: number): string {
  return `KES ${Math.round(amount).toLocaleString("en-KE")}`;
}
