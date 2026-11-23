import { OPERATORS, operatorColor } from "@/lib/meaning";

/** An operator's mark: its colour and its shape together, so neither has to be told apart alone. */
export function OperatorMark({ slug, className = "" }: { slug: string; className?: string }) {
  const shape = OPERATORS[slug]?.shape ?? "circle";
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-[0.5625rem] w-[0.5625rem] shrink-0 ${shape === "circle" ? "rounded-full" : shape === "diamond" ? "rotate-45" : ""} ${className}`}
      style={{ background: operatorColor(slug) }}
    />
  );
}

/** An operator by name, with its mark. */
export function Operator({ slug, name, className = "" }: { slug: string; name: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap font-medium ${className}`}>
      <OperatorMark slug={slug} />
      {name}
    </span>
  );
}

/** A state in words, with a dot in its colour. */
export function Status({ color, children, className = "" }: { color: string; children: React.ReactNode; className?: string }) {
  return (
    <span className={`status ${className}`} style={{ color }}>
      {children}
    </span>
  );
}
