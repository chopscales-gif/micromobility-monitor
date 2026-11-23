// Charts drawn as plain boxes, so the words around them stay full size on a phone
// and every bar can say its own figure when pointed at.

import { count } from "@/lib/format";
import { share } from "@/lib/report";

export type Segment = { key: string; value: number; color: string };
const PALE = "var(--color-bar)";

/** A bar for each column, stacked by segment, first segment on top. A column with a `tick` gets that label under it. */
export function Columns({ columns, height = 168, ariaLabel, scale }: { columns: { key: string; title: string; tick?: string; segments: Segment[] }[]; height?: number; ariaLabel: string; /** The value a full-height bar stands for, when several charts must share one. */ scale?: number }) {
  const totals = columns.map((c) => c.segments.reduce((sum, s) => sum + s.value, 0));
  const max = scale ?? Math.max(1, ...totals);
  // A single pale series has its tallest bar picked out in the brand colour, so the peak reads first.
  const peak = Math.max(...totals);
  const paint = (s: Segment, i: number) => (s.color === PALE && peak > 0 && totals[i] === peak ? "var(--color-brand)" : s.color);
  return (
    <div role="img" aria-label={ariaLabel}>
      <div className="flex items-end gap-px border-b border-rule sm:gap-1" style={{ height, backgroundImage: "linear-gradient(var(--color-line) 1px, transparent 1px)", backgroundSize: "100% 25%" }}>
        {columns.map((c, at) => (
          <div key={c.key} title={c.title} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-px">
            {c.segments
              .filter((s) => s.value > 0)
              .map((s, i) => (
                <div key={s.key} className={i === 0 ? "rounded-t-[5px]" : ""} style={{ height: `${(s.value / max) * 100}%`, background: paint(s, at) }} />
              ))}
          </div>
        ))}
      </div>
      <div className="flex gap-px pt-1.5 sm:gap-1" aria-hidden="true">
        {columns.map((c) => (
          <div key={c.key} className="relative h-5 min-w-0 flex-1">
            {c.tick && <span className="absolute left-0 top-0 whitespace-nowrap text-[0.8125rem] text-faint">{c.tick}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A line for each band: its name, a bar for its share, and the count. */
export function Bands({ bands, unit = "rides" }: { bands: { label: string; value: number }[]; unit?: string }) {
  const total = bands.reduce((sum, b) => sum + b.value, 0);
  const max = Math.max(1, ...bands.map((b) => b.value));
  return (
    <ul>
      {bands.map((b) => (
        <li key={b.label} className="row grid-cols-[6.5rem_minmax(0,1fr)_7.5rem] items-center last:border-b-0" title={`${count(b.value)} ${unit}`}>
          <span>{b.label}</span>
          <span className="h-3 overflow-hidden rounded-full bg-raise">
            <span className="block h-full rounded-full" style={{ width: `${Math.max(b.value > 0 ? 2 : 0, (b.value / max) * 100)}%`, background: b.value === max ? "var(--color-brand)" : "var(--color-bar)" }} />
          </span>
          <span className="text-right">
            <span className="font-semibold">{share(b.value, total)}</span> <span className="text-[0.8125rem] text-faint">{count(b.value)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
