import React from "react";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

export type InvoicePdfData = {
  businessName: string;
  businessAddress?: string;
  businessPhone?: string;
  invoiceNumber: string;
  kind: string;
  status: string;
  issuedAt: Date | null;
  dueAt: Date | null;
  customerName: string;
  customerPhone: string;
  bookingDate: string;
  bookingTime?: string;
  eventType?: string;
  items: { description: string; qty: number; unitPriceKes: number }[];
  subtotalKes: number;
  discountKes: number;
  taxKes: number;
  totalKes: number;
  paidKes: number;
  balanceKes: number;
  notes?: string;
};

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica", color: "#1c1917" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 22 },
  brand: { fontSize: 18, fontFamily: "Helvetica-Bold", color: "#c2410c" },
  muted: { color: "#78716c", fontSize: 9 },
  invoiceTitle: { fontSize: 22, fontFamily: "Helvetica-Bold", textAlign: "right" },
  section: { flexDirection: "row", justifyContent: "space-between", marginBottom: 18 },
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e7e5e0",
    paddingBottom: 6,
    marginBottom: 6,
    fontFamily: "Helvetica-Bold",
  },
  row: { flexDirection: "row", paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: "#f5f5f4" },
  colDesc: { flex: 4 },
  colQty: { flex: 1, textAlign: "right" },
  colPrice: { flex: 1.4, textAlign: "right" },
  colTotal: { flex: 1.4, textAlign: "right" },
  totals: { marginTop: 12, alignSelf: "flex-end", width: 220 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  grand: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 6,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: "#1c1917",
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
  },
  badge: {
    backgroundColor: "#fff7ed",
    color: "#c2410c",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    fontSize: 9,
    textTransform: "uppercase",
  },
  footer: { position: "absolute", bottom: 30, left: 36, right: 36, fontSize: 8, color: "#a8a29e" },
});

function fmt(n: number): string {
  return `KES ${Math.round(n).toLocaleString("en-KE")}`;
}

function InvoiceDoc({ data }: { data: InvoicePdfData }) {
  return (
    <Document title={`Invoice ${data.invoiceNumber}`} author={data.businessName}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>{data.businessName}</Text>
            <Text style={styles.muted}>{data.businessAddress ?? "Karen, Nairobi, Kenya"}</Text>
            <Text style={styles.muted}>{data.businessPhone ?? ""}</Text>
          </View>
          <View>
            <Text style={styles.invoiceTitle}>INVOICE</Text>
            <Text style={styles.muted}>{data.invoiceNumber}</Text>
            <Text style={[styles.badge, { marginTop: 6, alignSelf: "flex-end" }]}>{data.status}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <View>
            <Text style={styles.muted}>BILLED TO</Text>
            <Text style={{ fontFamily: "Helvetica-Bold", marginTop: 3 }}>{data.customerName}</Text>
            <Text>{data.customerPhone}</Text>
          </View>
          <View style={{ textAlign: "right" }}>
            <Text style={styles.muted}>BOOKING</Text>
            <Text style={{ marginTop: 3 }}>
              {data.bookingDate}
              {data.bookingTime ? ` · ${data.bookingTime}` : ""}
            </Text>
            {data.eventType ? <Text style={{ textTransform: "capitalize" }}>{data.eventType}</Text> : null}
            <Text style={styles.muted}>Issued {data.issuedAt ? data.issuedAt.toDateString() : "—"}</Text>
            <Text style={styles.muted}>Due {data.dueAt ? data.dueAt.toDateString() : "—"}</Text>
          </View>
        </View>

        <View style={styles.tableHead}>
          <Text style={styles.colDesc}>Description</Text>
          <Text style={styles.colQty}>Qty</Text>
          <Text style={styles.colPrice}>Unit price</Text>
          <Text style={styles.colTotal}>Total</Text>
        </View>
        {data.items.map((item, i) => (
          <View style={styles.row} key={i}>
            <Text style={styles.colDesc}>{item.description}</Text>
            <Text style={styles.colQty}>{item.qty}</Text>
            <Text style={styles.colPrice}>{fmt(item.unitPriceKes)}</Text>
            <Text style={styles.colTotal}>{fmt(item.qty * item.unitPriceKes)}</Text>
          </View>
        ))}

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text>Subtotal</Text>
            <Text>{fmt(data.subtotalKes)}</Text>
          </View>
          {data.discountKes > 0 ? (
            <View style={styles.totalRow}>
              <Text>Discount</Text>
              <Text>-{fmt(data.discountKes)}</Text>
            </View>
          ) : null}
          {data.taxKes > 0 ? (
            <View style={styles.totalRow}>
              <Text>VAT</Text>
              <Text>{fmt(data.taxKes)}</Text>
            </View>
          ) : null}
          <View style={styles.grand}>
            <Text>Total</Text>
            <Text>{fmt(data.totalKes)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text>Paid</Text>
            <Text>-{fmt(data.paidKes)}</Text>
          </View>
          <View style={styles.grand}>
            <Text>Balance due</Text>
            <Text>{fmt(data.balanceKes)}</Text>
          </View>
        </View>

        <Text style={styles.footer}>
          {data.businessName} · Thank you for booking with us. Payment via M-Pesa Till or bank transfer.
          {data.notes ? ` · ${data.notes}` : ""}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  const stream = await renderToBuffer(<InvoiceDoc data={data} />);
  return Buffer.from(stream);
}
