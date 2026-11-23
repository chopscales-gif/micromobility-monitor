"use client";

import { useState } from "react";
import { THEME_COOKIE, type Theme } from "@/lib/theme";

/** Light is the default. The choice is kept in a cookie so the server draws the right theme first time. */
export function ThemeToggle({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);
  const flip = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    setTheme(next);
  };
  return (
    <button type="button" onClick={flip} aria-label={`Switch to the ${theme === "dark" ? "light" : "dark"} theme`} className="flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[0.8125rem] text-dim transition-colors hover:bg-raise hover:text-text">
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 1a6 6 0 0 1 0 12Z" fill="currentColor" />
      </svg>
      <span className="max-lg:sr-only">{theme === "dark" ? "Light theme" : "Dark theme"}</span>
    </button>
  );
}
