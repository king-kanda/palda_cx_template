import { and, asc, eq, gt, inArray, lt, ne } from "drizzle-orm";
import { schema } from "@garden/db";
import { withPrincipal, getSettings, type ServiceContext } from "./context";
import {
  addMinutes,
  dateKey,
  endOfNairobiDay,
  hhmmToMinutes,
  minutesToHhmm,
  nairobiTime,
  startOfNairobiDay,
  weekdayOf,
} from "./tz";
import { NotFoundError, type Principal } from "./types";
import type { Resource } from "@garden/db";

export type ResourceStatus = "free" | "booked" | "hold" | "blocked";

export type ResourceAvailability = {
  resourceId: string;
  name: string;
  parentId: string | null;
  capacity: number | null;
  status: ResourceStatus;
  bookingId: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
};

function overlaps(startsAt: Date, endsAt: Date, a: Date, b: Date): boolean {
  return startsAt < b && endsAt > a;
}

async function activeResources(ctx: ServiceContext, kind: string): Promise<Resource[]> {
  return ctx.db.query.resources.findMany({
    where: (r, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(r.tenantId, ctx.tenantId), eqOp(r.kind, kind), eqOp(r.active, true)),
    orderBy: (r, { asc: ascOp }) => [ascOp(r.sortOrder), ascOp(r.name)],
  });
}

/** Parent bookings block every child; child bookings do not block siblings. */
export async function expandResourceIds(ctx: ServiceContext, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const all = await ctx.db.query.resources.findMany({
    where: (r, { and: andOp, eq: eqOp }) => andOp(eqOp(r.tenantId, ctx.tenantId), eqOp(r.active, true)),
  });
  const children = new Map<string, string[]>();
  for (const r of all) {
    if (r.parentResourceId) {
      const list = children.get(r.parentResourceId) ?? [];
      list.push(r.id);
      children.set(r.parentResourceId, list);
    }
  }
  const out = new Set<string>();
  const walk = (id: string) => {
    if (out.has(id)) return;
    out.add(id);
    for (const child of children.get(id) ?? []) walk(child);
  };
  for (const id of ids) walk(id);
  return [...out];
}

type Occupancy = {
  resourceId: string;
  bookingId: string | null;
  kind: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  bookingStatus: string | null;
};

async function occupancyBetween(ctx: ServiceContext, startsAt: Date, endsAt: Date): Promise<Occupancy[]> {
  const rows = await ctx.db
    .select({
      resourceId: schema.resourceOccupancy.resourceId,
      bookingId: schema.resourceOccupancy.bookingId,
      kind: schema.resourceOccupancy.kind,
      status: schema.resourceOccupancy.status,
      startsAt: schema.resourceOccupancy.startsAt,
      endsAt: schema.resourceOccupancy.endsAt,
      bookingStatus: schema.bookings.status,
    })
    .from(schema.resourceOccupancy)
    .leftJoin(schema.bookings, eq(schema.resourceOccupancy.bookingId, schema.bookings.id))
    .where(
      and(
        eq(schema.resourceOccupancy.tenantId, ctx.tenantId),
        eq(schema.resourceOccupancy.status, "active"),
        lt(schema.resourceOccupancy.startsAt, endsAt),
        gt(schema.resourceOccupancy.endsAt, startsAt),
      ),
    );
  return rows;
}

export type WindowAvailabilityInput = {
  resourceKind: string;
  startsAt: Date;
  endsAt: Date;
  partySize?: number;
  resourceIds?: string[];
  bufferBeforeMin?: number;
  bufferAfterMin?: number;
};

export async function checkWindow(
  ctx: ServiceContext,
  input: WindowAvailabilityInput,
): Promise<ResourceAvailability[]> {
  const resources = (await activeResources(ctx, input.resourceKind)).filter(
    (r) => !input.resourceIds?.length || input.resourceIds.includes(r.id),
  );
  const from = addMinutes(input.startsAt, -(input.bufferBeforeMin ?? 0));
  const to = addMinutes(input.endsAt, input.bufferAfterMin ?? 0);
  const occupied = await occupancyBetween(ctx, from, to);
  const occupancyByResource = new Map<string, Occupancy[]>();
  for (const o of occupied) {
    const list = occupancyByResource.get(o.resourceId) ?? [];
    list.push(o);
    occupancyByResource.set(o.resourceId, list);
  }
  const children = new Map<string, string[]>();
  for (const r of resources) {
    if (r.parentResourceId) {
      const list = children.get(r.parentResourceId) ?? [];
      list.push(r.id);
      children.set(r.parentResourceId, list);
    }
  }

  return resources.map((r) => {
    const candidates = [r.id, ...(children.get(r.id) ?? [])];
    for (const id of candidates) {
      const hit = (occupancyByResource.get(id) ?? []).find((o) =>
        overlaps(o.startsAt, o.endsAt, from, to),
      );
      if (hit) {
        const kind: ResourceStatus =
          hit.kind === "block" ? "blocked" : hit.bookingStatus === "hold" ? "hold" : "booked";
        return {
          resourceId: r.id,
          name: r.name,
          parentId: r.parentResourceId,
          capacity: r.capacity,
          status: kind,
          bookingId: hit.bookingId,
          startsAt: hit.startsAt,
          endsAt: hit.endsAt,
        };
      }
    }
    const capacityOk = input.partySize == null || !r.capacity || input.partySize <= r.capacity;
    return {
      resourceId: r.id,
      name: r.name,
      parentId: r.parentResourceId,
      capacity: r.capacity,
      status: capacityOk ? "free" : "blocked",
      bookingId: null,
      startsAt: null,
      endsAt: null,
    };
  });
}

/** Cross-checks a proposed booking window. Throws are handled by the caller. */
export async function conflictsFor(
  ctx: ServiceContext,
  input: {
    resourceIds: string[];
    startsAt: Date;
    endsAt: Date;
    bufferBeforeMin?: number;
    bufferAfterMin?: number;
    ignoreBookingId?: string;
  },
): Promise<{ resourceId: string; bookingId: string | null; kind: string }[]> {
  const expanded = await expandResourceIds(ctx, input.resourceIds);
  const from = addMinutes(input.startsAt, -(input.bufferBeforeMin ?? 0));
  const to = addMinutes(input.endsAt, input.bufferAfterMin ?? 0);
  const rows = await occupancyBetween(ctx, from, to);
  return rows
    .filter((o) => expanded.includes(o.resourceId))
    .filter((o) => !input.ignoreBookingId || o.bookingId !== input.ignoreBookingId)
    .map((o) => ({ resourceId: o.resourceId, bookingId: o.bookingId, kind: o.kind }));
}

export type Slot = {
  startsAt: Date;
  endsAt: Date;
  resourceId: string;
  available: boolean;
  reason?: string;
};

export async function getSlots(
  ctx: ServiceContext,
  input: { offeringId: string; dateKey: string; resourceId?: string },
): Promise<Slot[]> {
  const offering = await ctx.db.query.offerings.findFirst({
    where: eq(schema.offerings.id, input.offeringId),
  });
  if (!offering || offering.tenantId !== ctx.tenantId) throw new NotFoundError("Offering", input.offeringId);
  const settings = await getSettings(ctx);
  const hours = settings.workingHours[weekdayOf(input.dateKey)];
  if (!hours) return [];
  const resources = (await activeResources(ctx, offering.resourceKind)).filter(
    (r) => !input.resourceId || r.id === input.resourceId,
  );
  const open = hhmmToMinutes(hours.open);
  const close = hhmmToMinutes(hours.close);
  const interval = settings.slotIntervalMin;
  const duration = offering.durationMin;
  const occupancy = await occupancyBetween(
    ctx,
    nairobiTime(input.dateKey, hours.open),
    nairobiTime(input.dateKey, hours.close),
  );
  const byResource = new Map<string, Occupancy[]>();
  for (const o of occupancy) {
    const list = byResource.get(o.resourceId) ?? [];
    list.push(o);
    byResource.set(o.resourceId, list);
  }

  const slots: Slot[] = [];
  for (let minute = open; minute + duration <= close; minute += interval) {
    const startsAt = nairobiTime(input.dateKey, minutesToHhmm(minute));
    const endsAt = addMinutes(startsAt, duration);
    const from = addMinutes(startsAt, -offering.bufferBeforeMin);
    const to = addMinutes(endsAt, offering.bufferAfterMin);
    for (const resource of resources) {
      const conflict = (byResource.get(resource.id) ?? []).some((o) =>
        overlaps(o.startsAt, o.endsAt, from, to),
      );
      slots.push({
        startsAt,
        endsAt,
        resourceId: resource.id,
        available: !conflict,
        reason: conflict ? "occupied" : undefined,
      });
    }
  }
  return slots;
}

export type GridCell = {
  resourceId: string;
  dateKey: string;
  status: ResourceStatus;
  bookingId: string | null;
  label?: string;
};

export type AvailabilityGrid = {
  resources: { id: string; name: string; capacity: number | null; parentId: string | null }[];
  days: string[];
  cells: Record<string, GridCell>;
};

/** The bookings screen grid: resources × days, venue-style. */
export async function getAvailabilityGrid(
  ctx: ServiceContext,
  input: { fromDateKey: string; days: number; resourceKind?: string },
): Promise<AvailabilityGrid> {
  const settings = await getSettings(ctx);
  const kind = input.resourceKind ?? (settings.preset.bookingMode === "range" ? "space" : "staff");
  const resources = await activeResources(ctx, kind);
  const days = Array.from({ length: input.days }, (_, i) => {
    const d = nairobiTime(input.fromDateKey, "12:00");
    d.setUTCDate(d.getUTCDate() + i);
    return dateKey(d);
  });
  const start = startOfNairobiDay(days[0]!);
  const end = endOfNairobiDay(days[days.length - 1]!);
  const occupancy = await occupancyBetween(ctx, start, end);
  const byResource = new Map<string, Occupancy[]>();
  for (const o of occupancy) {
    const list = byResource.get(o.resourceId) ?? [];
    list.push(o);
    byResource.set(o.resourceId, list);
  }
  const children = new Map<string, string[]>();
  for (const r of resources) {
    if (r.parentResourceId) {
      const list = children.get(r.parentResourceId) ?? [];
      list.push(r.id);
      children.set(r.parentResourceId, list);
    }
  }
  const cells: Record<string, GridCell> = {};
  for (const resource of resources) {
    const ids = [resource.id, ...(children.get(resource.id) ?? [])];
    for (const day of days) {
      const dayStart = startOfNairobiDay(day);
      const dayEnd = endOfNairobiDay(day);
      let status: ResourceStatus = "free";
      let bookingId: string | null = null;
      for (const id of ids) {
        const hit = (byResource.get(id) ?? []).find((o) =>
          overlaps(o.startsAt, o.endsAt, dayStart, dayEnd),
        );
        if (hit) {
          status = hit.kind === "block" ? "blocked" : hit.bookingStatus === "hold" ? "hold" : "booked";
          bookingId = hit.bookingId;
          break;
        }
      }
      cells[`${resource.id}:${day}`] = {
        resourceId: resource.id,
        dateKey: day,
        status,
        bookingId,
      };
    }
  }
  return {
    resources: resources.map((r) => ({
      id: r.id,
      name: r.name,
      capacity: r.capacity,
      parentId: r.parentResourceId,
    })),
    days,
    cells,
  };
}

export async function checkAvailability(
  principal: Principal,
  input: { offeringId: string; startsAt: string; endsAt?: string; partySize?: number; resourceId?: string },
) {
  return withPrincipal(principal, async (ctx) => {
    const offering = await ctx.db.query.offerings.findFirst({
      where: eq(schema.offerings.id, input.offeringId),
    });
    if (!offering || offering.tenantId !== ctx.tenantId) throw new NotFoundError("Offering", input.offeringId);
    const startsAt = new Date(input.startsAt);
    const endsAt = input.endsAt ? new Date(input.endsAt) : addMinutes(startsAt, offering.durationMin);
    const results = await checkWindow(ctx, {
      resourceKind: offering.resourceKind,
      startsAt,
      endsAt,
      partySize: input.partySize,
      resourceIds: input.resourceId ? [input.resourceId] : undefined,
      bufferBeforeMin: offering.bufferBeforeMin,
      bufferAfterMin: offering.bufferAfterMin,
    });
    return { startsAt, endsAt, resources: results };
  });
}

export async function listBlocked(ctx: ServiceContext, from: Date, to: Date) {
  return ctx.db.query.blocks.findMany({
    where: (b, { and: andOp, eq: eqOp, gt: gtOp, lt: ltOp }) =>
      andOp(
        eqOp(b.tenantId, ctx.tenantId),
        ltOp(b.startsAt, to),
        gtOp(b.endsAt, from),
      ),
    orderBy: asc(schema.blocks.startsAt),
  });
}

export { inArray, ne };
