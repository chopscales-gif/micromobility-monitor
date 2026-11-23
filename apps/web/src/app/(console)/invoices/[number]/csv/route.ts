import { monthLabel } from "@mm/core/city";
import { csvResponse, toCsv } from "@/lib/csv";
import { verdict } from "@/lib/invoice";
import { download } from "@/server/download";
import { invoiceDetail } from "@/server/fees";
import { currentPerson } from "@/server/session";

const dollars = (cents: number | null) => (cents === null ? "" : (cents / 100).toFixed(2));

export async function GET(_request: Request, { params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  return download(async () => {
    const invoice = await invoiceDetail(await currentPerson(), number, "export", "csv");
    if (!invoice) return null;
    const v = verdict(invoice);
    return csvResponse(
      `${invoice.number}.csv`,
      toCsv([
        ["DEMONSTRATION DOCUMENT. Simulated data, fictional operator. Not a real bill."],
        [],
        ["Invoice", invoice.number],
        ["Operator", invoice.operatorName],
        ["Billing period", monthLabel(invoice.year, invoice.month)],
        ["Calculated (UTC)", new Date(invoice.generatedAt).toISOString()],
        [],
        ["Charge", "Quantity", "Unit", "Amount (USD)"],
        ...invoice.lines.map((l) => [l.description, l.quantity, l.unitLabel, dollars(l.amountCents)]),
        ["Amount due", "", "", dollars(invoice.totalCents)],
        [],
        ["Reconciliation", v.label],
        ["Rides counted by the city", invoice.observedTrips],
        ["Rides reported by the operator", invoice.reportedTrips ?? "not filed"],
        ["Difference (city minus operator)", invoice.deltaTrips ?? ""],
        ["Difference as % of the city's count", invoice.deltaPct === null ? "" : invoice.deltaPct.toFixed(2)],
        ["Fee at risk (USD)", dollars(invoice.feeAtRiskCents)],
        ["Trip records rejected by schema", invoice.rejectedTripRecords],
        ["Finding", `${v.headline} ${v.explanation}`],
      ]),
    );
  });
}
