"use client";

import { useEffect, useState } from "react";
import PixelScenery from "./components/PixelScenery";

const MENU_ITEMS = [
  "Enter the Wasteland",
  "Character Record",
  "Faction Ledger",
  "Options",
  "Abandon Post",
];

function themeForDate(date) {
  const hour = date.getHours();
  return hour >= 5 && hour < 18 ? "dawn" : "dusk";
}

export default function Home() {
  const [theme, setTheme] = useState("dawn");

  useEffect(() => {
    const update = () => setTheme(themeForDate(new Date()));
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div data-theme={theme} className="crt-screen">
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <filter id="crt-warp" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.0015 0.003"
            numOctaves="1"
            seed="7"
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="5"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </svg>

      <PixelScenery />
      <div className="crt-scanlines" />
      <div className="crt-vignette" />

      <main className="relative z-10 flex h-full flex-col items-center justify-center gap-8 px-6 text-center">
        <div>
          <h1 className="crt-heading text-5xl font-bold tracking-widest sm:text-6xl">
            LIFEWEB
          </h1>
          <p className="mt-2 text-sm tracking-[0.3em] uppercase opacity-80">
            a barony amid the wasteland
          </p>
        </div>

        <div className="crt-panel max-w-xl px-6 py-5 text-left text-sm leading-relaxed sm:text-base">
          <p>
            The wind carries dust and old machine-song across the wastes.
            Somewhere below the keep, the goo dreams in its veins of copper
            and bone. You have come — mercenary, princess, brigand, pusher,
            knight — to see what the barony will make of you.
          </p>
        </div>

        <ul className="flex flex-col items-center gap-2 text-base sm:text-lg">
          {MENU_ITEMS.map((item) => (
            <li key={item}>
              <button type="button" className="menu-item">
                &gt; {item}
              </button>
            </li>
          ))}
        </ul>

        <p className="text-xs tracking-widest opacity-60">
          LIFEWEB — build v0.0.1 — {theme} mode
        </p>
      </main>
    </div>
  );
}
