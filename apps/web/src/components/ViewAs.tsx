"use client";

import { useRef } from "react";
import { viewAs } from "@/app/actions";

type Option = { userId: string; name: string; title: string; roleLabel: string };

/** The demonstration's stand-in for signing in: pick whose seat to sit in. */
export function ViewAs({ people, current }: { people: Option[]; current: string }) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action={viewAs} className="flex min-w-0 max-w-full items-center gap-2">
      <label htmlFor="view-as" className="whitespace-nowrap text-white/70">
        No sign-in<span className="max-sm:hidden"> in this demonstration</span>. Seat
      </label>
      <select
        id="view-as"
        name="person"
        defaultValue={current}
        key={current}
        onChange={() => form.current?.requestSubmit()}
        className="min-w-0 flex-1 cursor-pointer text-ellipsis rounded-md border border-white/25 bg-white/10 px-2 py-1 font-medium text-white"
      >
        {people.map((p) => (
          <option key={p.userId} value={p.userId} className="text-black">
            {p.name} · {p.roleLabel}
          </option>
        ))}
      </select>
    </form>
  );
}
