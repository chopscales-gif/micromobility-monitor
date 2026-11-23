"use client";

import { useTransition } from "react";
import { resetDemo } from "@/app/actions";

/** Shown on a shared copy of the demonstration: what a visitor changes, the next one would find. */
export function DemoReset() {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => resetDemo())}
      className="cursor-pointer whitespace-nowrap font-semibold text-signal underline decoration-signal/40 underline-offset-2 hover:decoration-signal disabled:cursor-wait disabled:no-underline disabled:opacity-70"
    >
      {pending ? "Putting it back…" : "Reset it now"}
    </button>
  );
}
