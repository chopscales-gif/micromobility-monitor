// What may leave the building. Trip records are never published; only counts are,
// and only once a count is large enough that no one rider can be picked out of it.

/** The smallest count that may be published. A group of fewer than this many rides is withheld. */
export const K_ANONYMITY_MIN = 10;
/** Published coordinates keep this many decimal places: about 100 metres on the ground. */
export const PUBLIC_COORD_DECIMALS = 3;
/** H3 resolution of the public maps: hexagons about 900 metres across, one step coarser than the console's own. */
export const PUBLIC_H3_RESOLUTION = 8;

/** How long the path of a ride is kept before the daily job deletes it, unless the setting says otherwise. */
export const ROUTE_RETENTION_DAYS_DEFAULT = 90;

/**
 * The keeping time for routes, given the ROUTE_RETENTION_DAYS setting as it was read. The worker that deletes, the seed
 * and the public page that states the figure all ask here, so they cannot disagree about what a value means.
 * Anything that is not a whole number of days, one or more, falls back to the default rather than deleting on a guess.
 */
export function routeRetentionDays(raw: string | undefined): number {
  const days = Number(raw);
  return raw !== undefined && raw.trim() !== "" && Number.isInteger(days) && days >= 1 ? days : ROUTE_RETENTION_DAYS_DEFAULT;
}

export function roundCoord(value: number, decimals = PUBLIC_COORD_DECIMALS): number {
  const factor = 10 ** decimals;
  // Adding zero turns a rounded "-0" back into 0.
  return Math.round(value * factor) / factor + 0;
}

/** A count as it may be published: itself, or null when it is too small to share. Zero says nothing about anybody and is kept. */
export function publishable(count: number, k = K_ANONYMITY_MIN): number | null {
  return count === 0 || count >= k ? count : null;
}

/**
 * A breakdown that is published beside its total. Small cells are withheld; and if the cells
 * withheld together still come to fewer than k rides, the total would give them away by
 * subtraction, so the next smallest cell is withheld as well until it cannot.
 */
export function protectBreakdown(counts: readonly number[], k = K_ANONYMITY_MIN): (number | null)[] {
  const out: (number | null)[] = counts.map((n) => publishable(n, k));
  let hidden = counts.reduce((sum, n, i) => (out[i] === null ? sum + n : sum), 0);
  if (hidden === 0) return out;
  const rest = counts.map((n, i) => ({ n, i })).filter(({ n, i }) => out[i] !== null && n > 0).sort((a, b) => a.n - b.n);
  for (const { n, i } of rest) {
    if (hidden >= k) break;
    out[i] = null;
    hidden += n;
  }
  return out;
}

/** A share of a total as it may be published: null when either side of the split is a group too small to share. */
export function publishableShare(part: number, total: number, k = K_ANONYMITY_MIN): number | null {
  if (total <= 0) return null;
  return publishable(part, k) === null || publishable(total - part, k) === null ? null : part / total;
}

/** How many rides sit in the withheld cells: the gap between a published total and the cells shown under it. */
export function withheldTotal(counts: readonly number[], published: readonly (number | null)[]): number {
  return counts.reduce((sum, n, i) => (published[i] === null ? sum + n : sum), 0);
}
