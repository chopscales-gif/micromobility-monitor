// Lets the ingestion code read the simulated feeds without a network hop, with
// the clock under the caller's control. Seeding uses this to replay months of
// history in minutes; the hosted demo uses it because it has no second server.

import { handleSimRequest } from "./handler";
import { rng } from "./random";

export function simFetcher(options: { seed: string; baseUrl: string; now: () => number }) {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  return async (url: string, headers: Record<string, string>) => {
    if (!url.startsWith(baseUrl)) return { status: 0, body: "", latencyMs: 0 };
    const parsed = new URL(url);
    const now = options.now();
    const response = handleSimRequest({
      path: parsed.pathname.slice(new URL(baseUrl).pathname.replace(/\/$/, "").length),
      query: parsed.searchParams,
      headers: { authorization: headers.authorization, accept: headers.accept },
      baseUrl,
      seed: options.seed,
      now,
    });
    // No real network here, so response time is the simulated server's: its delay plus ordinary jitter.
    const jitter = Math.round(60 + rng(options.seed, "latency", url, now).next() * 140);
    return { status: response.status, body: response.body, latencyMs: response.delayMs + jitter };
  };
}
