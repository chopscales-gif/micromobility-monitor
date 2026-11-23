// Replaying the last day in the browser from the list of status changes.

export type PlaybackData = {
  start: number;
  end: number;
  vehicles: { id: string; code: string; operator: string; type: string; state: string; lng: number | null; lat: number | null; battery: number | null }[];
  /** [vehicle index, seconds after the window opened, state, lng, lat, battery] */
  events: [number, number, string, number, number, number | null][];
};

type Moment = { sec: number; state: string; lng: number; lat: number; battery: number | null };
export type Timeline = { data: PlaybackData; perVehicle: Moment[][] };

export function buildTimeline(data: PlaybackData): Timeline {
  const perVehicle: Moment[][] = data.vehicles.map(() => []);
  for (const [index, sec, state, lng, lat, battery] of data.events) perVehicle[index]!.push({ sec, state, lng, lat, battery });
  return { data, perVehicle };
}

export type Placed = { id: string; code: string; operator: string; type: string; state: string; lng: number; lat: number; battery: number | null; since: number };

/** Where every vehicle was, and in what state, `sec` seconds into the window. */
export function fleetAt(timeline: Timeline, sec: number): Placed[] {
  const out: Placed[] = [];
  const { data, perVehicle } = timeline;
  for (let i = 0; i < data.vehicles.length; i++) {
    const v = data.vehicles[i]!;
    const moments = perVehicle[i]!;
    // Last change at or before this moment.
    let lo = 0;
    let hi = moments.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (moments[mid]!.sec <= sec) lo = mid + 1;
      else hi = mid;
    }
    const current = lo > 0 ? moments[lo - 1]! : v.lng === null || v.lat === null ? null : { sec: 0, state: v.state, lng: v.lng, lat: v.lat, battery: v.battery };
    if (!current) continue;
    let { lng, lat } = current;
    const next = moments[lo];
    // Mid-trip, the vehicle is drawn part-way along a straight line to where the trip ended.
    if (current.state === "on_trip" && next && next.sec > current.sec) {
      const along = (sec - current.sec) / (next.sec - current.sec);
      lng += (next.lng - lng) * along;
      lat += (next.lat - lat) * along;
    }
    out.push({ id: v.id, code: v.code, operator: v.operator, type: v.type, state: current.state, lng, lat, battery: current.battery, since: data.start + current.sec * 1000 });
  }
  return out;
}
