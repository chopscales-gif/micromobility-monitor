/** One CSV row. Cells that could be read as a formula by a spreadsheet are neutralised. */
const cell = (value: unknown): string => {
  let text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const toCsv = (rows: unknown[][]): string => rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";

export const csvResponse = (filename: string, body: string) =>
  new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "no-store" } });
