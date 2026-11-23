// How the monthly report says its figures, shared by the screen and the PDF.

export const km = (metres: number | null) => (metres === null ? "no data" : `${(metres / 1000).toFixed(1)} km`);
export const minutes = (seconds: number | null) => (seconds === null ? "no data" : `${Math.round(seconds / 60)} min`);
export const rate = (value: number | null) => (value === null ? "no data" : value.toFixed(2));

/** 0 to 23 as a clock hour: "8 am", "noon", "5 pm". */
export function hourLabel(hour: number): string {
  if (hour === 0) return "midnight";
  if (hour === 12) return "noon";
  return hour < 12 ? `${hour} am` : `${hour - 12} pm`;
}
/** The hour as a span: "5 to 6 pm". */
export function hourSpan(hour: number): string {
  const next = (hour + 1) % 24;
  const sameHalf = hour < 12 === next < 12 && hour !== 0 && next !== 0 && hour !== 12 && next !== 12;
  return sameHalf ? `${hour % 12} to ${hourLabel(next)}` : `${hourLabel(hour)} to ${hourLabel(next)}`;
}

/** A share of the whole to the nearest percent, without calling a small share nothing. */
export function share(part: number, whole: number): string {
  if (whole <= 0 || part <= 0) return "0%";
  const value = (part / whole) * 100;
  return value < 0.5 ? "under 1%" : `${Math.round(value)}%`;
}

const KNOWN_TYPES: Record<string, string> = { scooter: "E-scooter", bicycle: "E-bike" };
/** A vehicle type as a line in a table of rides. Some trip records name a vehicle the operator never listed. */
export const typeLine = (type: string) => (KNOWN_TYPES[type] ? `${KNOWN_TYPES[type]}s, all operators` : "Vehicles not on any roster");
/** A vehicle type as a column of rides. */
export const typeColumn = (type: string) => (KNOWN_TYPES[type] ? `${KNOWN_TYPES[type]}s` : "Other");
/** The usual types first, anything else after. */
export const orderTypes = (types: string[]) => [...new Set(types)].sort((a, b) => (a in KNOWN_TYPES ? 0 : 1) - (b in KNOWN_TYPES ? 0 : 1) || Object.keys(KNOWN_TYPES).indexOf(a) - Object.keys(KNOWN_TYPES).indexOf(b));
/** Whether a type is one the operators listed with the city. */
export const knownType = (type: string) => type in KNOWN_TYPES;
