"use client";

import { useEffect, useState } from "react";

type ThemeMode = "light" | "dark";

function readCurrentTheme(): ThemeMode {
  if (typeof document === "undefined") {
    return "light";
  }
  const value = document.documentElement.dataset.theme;
  return value === "dark" ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>("light");

  useEffect(() => {
    setTheme(readCurrentTheme());
  }, []);

  const toggle = () => {
    const next: ThemeMode = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem("site-theme", next);
    } catch {
      // ignore localStorage errors
    }
    setTheme(next);
  };

  return (
    <button type="button" className="theme-toggle" onClick={toggle} aria-label="Toggle light and dark theme">
      <span>{theme === "light" ? "Night" : "Day"}</span>
    </button>
  );
}
