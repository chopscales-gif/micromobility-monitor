/** The title every page opens with, and the sentence under it that says what the page is for. */
export function PageHead({ title, children, aside, above }: { title: string; children?: React.ReactNode; aside?: React.ReactNode; above?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div className="min-w-0 max-w-3xl">
        {above && <p className="mb-2 text-[0.8125rem] text-faint">{above}</p>}
        <h1 className="title">{title}</h1>
        {children && <p className="lede mt-2">{children}</p>}
      </div>
      {aside}
    </div>
  );
}

/** A row of links that choose between views of the same page. */
export function Choice({ options, current }: { options: { href: string; label: string; key: string }[]; current: string }) {
  return (
    <nav className="no-print flex rounded-lg border border-line bg-raise p-0.5" aria-label="View">
      {options.map((o) => (
        <a
          key={o.key}
          href={o.href}
          aria-current={o.key === current ? "page" : undefined}
          className={`whitespace-nowrap rounded-md px-3 py-1.5 text-[0.8125rem] ${o.key === current ? "bg-panel font-semibold text-text shadow-[var(--shadow-sm)]" : "text-dim hover:text-text"}`}
        >
          {o.label}
        </a>
      ))}
    </nav>
  );
}
