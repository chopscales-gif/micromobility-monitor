import { Refused } from "./guard";

/** Runs a guarded query for an API route. A refusal becomes a 403; it is already in the audit log. */
export async function respond(run: () => Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await run(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Refused) return Response.json({ error: "Your role does not include this." }, { status: 403 });
    throw error;
  }
}
