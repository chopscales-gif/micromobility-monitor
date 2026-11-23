import { Refused } from "./guard";

/** Runs a guarded export; a refusal or a missing invoice becomes a plain answer instead of a crash. */
export async function download(run: () => Promise<Response | null>): Promise<Response> {
  try {
    return (await run()) ?? new Response("No such invoice.", { status: 404 });
  } catch (error) {
    if (error instanceof Refused) return new Response("Your role may not export this. The attempt has been recorded in the audit log.", { status: 403 });
    throw error;
  }
}
