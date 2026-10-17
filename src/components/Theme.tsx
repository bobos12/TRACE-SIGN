"use client";
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type Mode = "system" | "light" | "dark";

/** Runs before paint (inlined in <head>) so there's no flash of the wrong theme. */
export const themeBootScript = `try{var m=localStorage.getItem("ts-theme");if(m==="light"||m==="dark")document.documentElement.dataset.theme=m}catch(e){}`;

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");
  useEffect(() => {
    try {
      const m = localStorage.getItem("ts-theme");
      if (m === "light" || m === "dark") setMode(m);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const apply = (m: Mode) => {
    setMode(m);
    try {
      if (m === "system") localStorage.removeItem("ts-theme");
      else localStorage.setItem("ts-theme", m);
    } catch {
      /* ignore */
    }
    if (m === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = m;
  };
  const opts: [Mode, typeof Sun, string][] = [
    ["light", Sun, "Light"],
    ["dark", Moon, "Dark"],
    ["system", Monitor, "System"],
  ];
  return (
    <div className="seg" role="radiogroup" aria-label="Theme">
      {opts.map(([m, Icon, label]) => (
        <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? "on" : ""} onClick={() => apply(m)} title={label} style={{ padding: "0 8px" }}>
          <Icon size={13} />
        </button>
      ))}
    </div>
  );
}
