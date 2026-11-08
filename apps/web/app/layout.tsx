import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Garden Booking OS",
  description: "Bookings, money and Wambo — the AI concierge for Kenyan service businesses.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
