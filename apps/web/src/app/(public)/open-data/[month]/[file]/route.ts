import { fileBody, FILES, type FileName } from "@/lib/open-data";
import { openData } from "@/server/open-data";

// Public files: no seat is asked for and nothing is logged, because each holds only published counts.
export async function GET(_request: Request, { params }: { params: Promise<{ month: string; file: string }> }) {
  const { month, file } = await params;
  const known = FILES.find((f) => f.file === file);
  const data = known ? await openData(month) : null;
  if (!known || !data) return new Response("There is no such file. Only finished months are published.", { status: 404 });
  return new Response(fileBody(data, file as FileName), {
    headers: {
      "content-type": file.endsWith(".geojson") ? "application/geo+json; charset=utf-8" : "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="demonstration-${month}-${file}"`,
      "cache-control": "no-store",
    },
  });
}
