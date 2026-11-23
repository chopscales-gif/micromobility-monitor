// Seeded randomness. Everything the simulator produces is a pure function of
// (seed, operator, service day), so the same seed always builds the same city.

function hashString(text: string): number {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

export type Rng = {
  next(): number;
  range(min: number, max: number): number;
  int(min: number, maxInclusive: number): number;
  chance(p: number): boolean;
  normal(mean: number, sd: number): number;
  pickWeighted<T>(items: readonly T[], weight: (item: T) => number): T;
};

export function rng(...seedParts: (string | number)[]): Rng {
  let a = hashString(seedParts.join("|"));
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const api: Rng = {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    chance: (p) => next() < p,
    normal: (mean, sd) => {
      const u = Math.max(next(), 1e-12);
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    },
    pickWeighted: (items, weight) => {
      let total = 0;
      for (const item of items) total += Math.max(0, weight(item));
      let roll = next() * total;
      for (const item of items) {
        roll -= Math.max(0, weight(item));
        if (roll <= 0) return item;
      }
      return items[items.length - 1]!;
    },
  };
  return api;
}

/** Deterministic UUID (version 4 layout) from seed parts. */
export function seededUuid(...seedParts: (string | number)[]): string {
  const r = rng("uuid", ...seedParts);
  const hex = Array.from({ length: 32 }, () => Math.floor(r.next() * 16).toString(16));
  hex[12] = "4";
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const s = hex.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
