import { timingSafeEqual } from "node:crypto";
import { scheduledReset } from "@/server/demo";

// The nightly reset for a hosted copy that runs without the worker. The host's scheduler calls this
// once a day with the shared secret; anyone else is refused. See vercel.json and the deploy guide.
export const maxDuration = 60;

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !same(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) return new Response("Not found", { status: 404 });
  return Response.json({ reset: await scheduledReset() });
}
