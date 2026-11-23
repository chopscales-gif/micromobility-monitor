// Where the worker reads the operators' feeds from.
//
// Normally over HTTP, from whatever addresses the operators are registered with. A hosted copy of the
// demonstration can set SIMULATOR_INPROCESS=1 instead: the simulated operators then answer from inside
// the worker, at the addresses they were registered with when the database was seeded, and there is no
// simulator process to run. Anything not at those addresses still goes over HTTP.

import type { Sql } from "@mm/db";
import { httpFetcher, type FeedFetcher } from "@mm/ingest";
import { simFetcher } from "@mm/simulator";

/** The simulator's address as the seed registered it, read back from one operator's feed address. */
export function simulatorBase(operator: { slug: string; gbfsUrl: string }): string | null {
  const at = operator.gbfsUrl.indexOf(`/${operator.slug}/gbfs/`);
  return at > 0 ? operator.gbfsUrl.slice(0, at) : null;
}

export async function feedFetcher(sql: Sql, env: NodeJS.ProcessEnv = process.env): Promise<{ fetcher: FeedFetcher; inProcess: string | null }> {
  if (!env.SIMULATOR_INPROCESS) return { fetcher: httpFetcher, inProcess: null };
  const [registered] = await sql`select slug, gbfs_url from operators order by slug limit 1`;
  const baseUrl = (registered && simulatorBase({ slug: registered.slug, gbfsUrl: registered.gbfs_url })) ?? (env.SIMULATOR_URL ?? "http://localhost:4010").replace(/\/$/, "");
  const simulated = simFetcher({ seed: env.SIM_SEED ?? "slc-demo", baseUrl, now: Date.now });
  const fetcher: FeedFetcher = (url, headers) => (url.startsWith(baseUrl) ? simulated(url, headers) : httpFetcher(url, headers));
  return { fetcher, inProcess: baseUrl };
}
