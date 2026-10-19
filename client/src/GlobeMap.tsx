// Spinning-globe world map, using the bundled Meta map runtime
// (hatch-maps.js) with its globe projection: drag to turn the earth,
// tap a country's dot to open its stations. The runtime ships as a
// classic script that declares a global `HatchMaps`, so we load our
// local copy as a text asset and inject it once, then mount through
// it. Fatal errors route to the caller's onUnavailable, which falls
// back to the plain country list (every country stays reachable).

import { useEffect, useRef } from "react";
import hatchMapsSource from "./assets/hatch-maps.txt";
import "./assets/hatch-maps.css";

export interface GlobePlace {
  label: string;
  lat: number;
  lng: number;
}

interface MapHandle {
  destroy: () => void;
  selectPlace: (index: number | null) => void;
}

interface HatchMapsApi {
  isMetaMapSupported: () => { supported: boolean };
  mountMap: (
    container: HTMLElement,
    options: Record<string, unknown>,
  ) => MapHandle | null;
}

declare global {
  interface Window {
    HatchMaps?: HatchMapsApi;
  }
}

let loadPromise: Promise<boolean> | null = null;

function ensureRuntime(): Promise<boolean> {
  if (window.HatchMaps) return Promise.resolve(true);
  if (!loadPromise) {
    loadPromise = new Promise<boolean>((resolve) => {
      try {
        const script = document.createElement("script");
        script.textContent = hatchMapsSource;
        document.head.appendChild(script);
        resolve(Boolean(window.HatchMaps));
      } catch {
        resolve(false);
      }
    });
  }
  return loadPromise;
}

interface GlobeMapProps {
  places: GlobePlace[];
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
  onUnavailable: () => void;
}

export function GlobeMap({
  places,
  selectedIndex,
  onSelect,
  onUnavailable,
}: GlobeMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<MapHandle | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const unavailableRef = useRef(onUnavailable);
  unavailableRef.current = onUnavailable;

  // Mount once per places-set. `globe: true` turns on the runtime's
  // globe projection — the earth you can drag around. Selection syncs
  // through onSelectPlace / selectPlace.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || places.length === 0) return;
    let cancelled = false;
    void (async () => {
      const ok = await ensureRuntime();
      if (cancelled) return;
      const api = window.HatchMaps;
      if (!ok || !api || !api.isMetaMapSupported().supported) {
        unavailableRef.current();
        return;
      }
      handleRef.current?.destroy();
      handleRef.current = api.mountMap(container, {
        places,
        globe: true,
        baseStyle: "dark",
        clientId: "artifact_web",
        onFatalError: () => unavailableRef.current(),
        onSelectPlace: (index: number | null) => selectRef.current(index),
      });
      if (!handleRef.current) unavailableRef.current();
    })();
    return () => {
      cancelled = true;
      handleRef.current?.destroy();
      handleRef.current = null;
    };
    // Remount only when the country set itself changes identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places]);

  useEffect(() => {
    handleRef.current?.selectPlace(selectedIndex);
  }, [selectedIndex]);

  return (
    <div
      ref={containerRef}
      className="h-[400px] w-full overflow-hidden rounded-[var(--radius)] border border-[var(--border)] sm:h-[540px]"
      role="img"
      aria-label="Globe of the earth with a dot for every country that has radio stations — drag to spin it, tap a dot to hear that country"
    />
  );
}
