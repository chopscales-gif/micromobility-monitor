import { renderToBuffer } from "@react-pdf/renderer";
import { ROLE_LABELS } from "@mm/core/access";
import { MonthlyReportPdf } from "@/components/MonthlyReportPdf";
import { download } from "@/server/download";
import { monthlyReport } from "@/server/reports";
import { currentPerson } from "@/server/session";

export async function GET(_request: Request, { params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  const answer = await download(async () => {
    const person = await currentPerson();
    const report = await monthlyReport(person, month, "export");
    // The report on paper is for a finished month; one still running is read on screen.
    if (!report || !report.closed) return null;
    const pdf = await renderToBuffer(<MonthlyReportPdf report={report} reader={{ name: person.name, roleLabel: ROLE_LABELS[person.role] }} />);
    return new Response(new Uint8Array(pdf), {
      headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="shared-mobility-report-${report.period}.pdf"`, "cache-control": "no-store" },
    });
  });
  return answer.status === 404 ? new Response("There is no finished month's report at this address.", { status: 404 }) : answer;
}
