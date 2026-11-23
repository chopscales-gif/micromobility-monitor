import { renderToBuffer } from "@react-pdf/renderer";
import { InvoicePdf } from "@/components/InvoicePdf";
import { download } from "@/server/download";
import { invoiceDetail } from "@/server/fees";
import { currentPerson } from "@/server/session";

export async function GET(_request: Request, { params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  return download(async () => {
    const invoice = await invoiceDetail(await currentPerson(), number, "export", "pdf");
    if (!invoice) return null;
    const pdf = await renderToBuffer(<InvoicePdf invoice={invoice} />);
    return new Response(new Uint8Array(pdf), {
      headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${invoice.number}.pdf"`, "cache-control": "no-store" },
    });
  });
}
