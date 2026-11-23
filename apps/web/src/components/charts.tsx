// Charts drawn as plain boxes, so the words around them stay full size on a phone
// and every bar can say its own figure when pointed at.

import { count } from "@/lib/format";
import { share } from "@/lib/report";

export type Segment = { key: string; value: number; color: string };

/** A bar for each column, stacked by segment, first segment on top. A column with a `tick` gets that label under it. */
export function Columns({ columns, height = 168, ariaLabel, scale }: { columns: { key: string; title: string; tick?: string; segments: Segment[] }[]; height?: number; ariaLabel: string; /** The value a full-height bar stands for, when several charts must share one. */ scale?: number }) {
  const max = scale ?? Math.max(1, ...columns.map((c) => c.segments.reduce((sum, s) => sum + s.value, 0)));
  return (
    <div role="img" aria-label={ariaLabel}>
      <div className="flex items-end gap-px border-b border-rule sm:gap-[3px]" style={{ height }}>
        {columns.map((c) => (
          <div key={c.key} title={c.title} className="flex h-full min-w-0 flex-1 flex-col justify-end">
            {c.segments.map((s, i) =>
              s.value > 0 ? <div key={s.key} className={i === 0 ? "rounded-t-[2px]" : ""} style={{ height: `${(s.value / max) * 100}%`, background: s.color }} /> : null,
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-px pt-1 sm:gap-[3px]" aria-hidden="true">
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
          <span className="h-2.5 rounded-[2px]" style={{ width: `${Math.max(b.value > 0 ? 1 : 0, (b.value / max) * 100)}%`, background: "var(--color-control)" }} />
          <span className="text-right">
            <span className="font-semibold">{share(b.value, total)}</span> <span className="text-[0.8125rem] text-faint">{count(b.value)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
