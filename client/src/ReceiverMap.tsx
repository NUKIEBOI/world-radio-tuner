// World map of receivers, using the bundled Meta map runtime
// (hatch-maps.js). The runtime ships as a classic script that declares
// a global `HatchMaps`, so we load our local copy as a text asset and
// inject it once, then mount through it — same mount contract as the
// shared map helpers (clientId + onFatalError routed to the caller's
// unavailable state, which falls back to the receiver list).

import { useEffect, useRef } from "react";
import hatchMapsSource from "./assets/hatch-maps.txt";
import "./assets/hatch-maps.css";

export interface MapPlace {
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

interface ReceiverMapProps {
  places: MapPlace[];
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
  onUnavailable: () => void;
}

export function ReceiverMap({
  places,
  selectedIndex,
  onSelect,
  onUnavailable,
}: ReceiverMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<MapHandle | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const unavailableRef = useRef(onUnavailable);
  unavailableRef.current = onUnavailable;

  // Mount once per places-set. The map draws its own default circle
  // layer for a list this size (~900 points); selection syncs through
  // onSelectPlace / selectPlace.
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
        baseStyle: window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light",
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
    // Remount only when the receiver set itself changes identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places]);

  useEffect(() => {
    handleRef.current?.selectPlace(selectedIndex);
  }, [selectedIndex]);

  return (
    <div
      ref={containerRef}
      className="h-[320px] w-full overflow-hidden rounded-[var(--radius)] border border-[var(--border)] sm:h-[380px]"
      role="img"
      aria-label="World map showing the locations of public radio receivers"
    />
  );
}
