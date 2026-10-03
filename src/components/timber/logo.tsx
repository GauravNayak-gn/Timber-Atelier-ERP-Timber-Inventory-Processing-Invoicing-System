"use client";

import { cn } from "@/lib/utils";

/**
 * Timber cross-section mark — concentric growth rings with a
 * single amber arc, drawn as an elegant inline SVG.
 */
export function TimberMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" className={cn("shrink-0", className)}>
      <rect
        x="2"
        y="2"
        width="44"
        height="44"
        rx="12"
        stroke="currentColor"
        strokeOpacity="0.28"
        strokeWidth="1.5"
      />
      {/* outer ring, slightly organic */}
      <circle cx="24.4" cy="23.6" r="13.4" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.6" />
      {/* middle ring */}
      <circle cx="23.7" cy="24.2" r="9.2" stroke="currentColor" strokeOpacity="0.7" strokeWidth="1.6" />
      {/* heartwood */}
      <circle cx="24.1" cy="23.9" r="4.7" fill="currentColor" />
      {/* amber growth-season arc */}
      <path
        d="M 24 10.6 A 13.4 13.4 0 0 1 37.4 24"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        className="text-primary"
      />
      {/* fine radial crack */}
      <path
        d="M24 3.5 L24 7"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
