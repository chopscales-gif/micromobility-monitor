import Link from "next/link";
import { count } from "@/lib/format";

export type FilterOption = { href: string; label: string; n: number; on: boolean; mark?: React.ReactNode };

/** One row of filter choices, each showing how many it would leave. */
export function Filter({ label, options }: { label: string; options: FilterOption[] }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
      <p className="label w-16 shrink-0">{label}</p>
      <ul className="flex flex-wrap gap-1">
        {options.map((o) => (
          <li key={o.label}>
            <Link
              href={o.href}
              aria-current={o.on ? "true" : undefined}
              className={`flex items-center gap-2 rounded-md px-2.5 py-1 text-[0.8125rem] transition-colors ${o.on ? "bg-text font-semibold text-ink" : "text-dim hover:bg-raise hover:text-text"}`}
            >
              {o.mark}
              {o.label}
              <span className={o.on ? "opacity-70" : "text-faint"}>{count(o.n)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
