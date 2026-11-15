"use client";

import { useState, useTransition, type DragEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { moveBookingToDayAction } from "./actions";

/**
 * Minimal drag-to-reschedule for staff (PLAN §2.3). The chip carries the
 * booking id; the day cell calls the same reschedule service as the booking
 * page, so policy and the DB overlap constraint still decide.
 */
export function DragBooking({ bookingId, children }: { bookingId: string; children: ReactNode }) {
  return (
    <span
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/booking-id", bookingId);
        event.dataTransfer.effectAllowed = "move";
      }}
      className="block cursor-grab"
    >
      {children}
    </span>
  );
}

export function DropDay({
  date,
  className,
  children,
}: {
  date: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [over, setOver] = useState(false);

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setOver(false);
    const bookingId = event.dataTransfer.getData("text/booking-id");
    if (!bookingId) return;
    const form = new FormData();
    form.set("bookingId", bookingId);
    form.set("date", date);
    startTransition(async () => {
      await moveBookingToDayAction(form);
      router.refresh();
    });
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`${className ?? ""} ${over ? "bg-lime-100 outline outline-2 outline-brand-700/40" : ""}`}
    >
      {children}
    </div>
  );
}
