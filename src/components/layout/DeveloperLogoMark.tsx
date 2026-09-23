"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

interface DeveloperLogoMarkProps {
  size?: number;
  className?: string;
  /** Subtle idle animation on the outer orbit */
  animated?: boolean;
}

/** Nexura Technologies mark — faceted N inside a glass hexagon. */
export function DeveloperLogoMark({
  size = 48,
  className,
  animated = true,
}: DeveloperLogoMarkProps) {
  const uid = useId().replace(/:/g, "");
  const bg = `nx-bg-${uid}`;
  const face = `nx-face-${uid}`;
  const edge = `nx-edge-${uid}`;
  const orbit = `nx-orbit-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      role="img"
      aria-label="Nexura Technologies"
    >
      <defs>
        <linearGradient id={bg} x1="10" y1="6" x2="54" y2="58">
          <stop offset="0%" stopColor="#1e1b4b" />
          <stop offset="55%" stopColor="#312e81" />
          <stop offset="100%" stopColor="#0e7490" />
        </linearGradient>
        <linearGradient id={face} x1="20" y1="18" x2="44" y2="46">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#a5f3fc" />
        </linearGradient>
        <linearGradient id={edge} x1="8" y1="8" x2="56" y2="56">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#67e8f9" stopOpacity="0.6" />
        </linearGradient>
        <linearGradient id={orbit} x1="0" y1="0" x2="64" y2="64">
          <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.15" />
        </linearGradient>
      </defs>

      <circle
        cx="32"
        cy="32"
        r="30.5"
        stroke={`url(#${orbit})`}
        strokeWidth="1"
        strokeDasharray="3 5"
        className={animated ? "animate-[spin_24s_linear_infinite]" : undefined}
        style={{ transformOrigin: "32px 32px" }}
      />

      <path
        d="M32 5.5 L54.5 18.5 V45.5 L32 58.5 L9.5 45.5 V18.5 Z"
        fill={`url(#${bg})`}
        stroke={`url(#${edge})`}
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M32 5.5 L54.5 18.5 L32 31.5 L9.5 18.5 Z" fill="#ffffff" fillOpacity="0.07" />

      <path
        d="M21 43 V21 L43 43 V21"
        stroke={`url(#${face})`}
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M21 21 L43 43" stroke="#0e7490" strokeOpacity="0.35" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="43" cy="21" r="2.6" fill="#22d3ee" stroke="#ffffff" strokeWidth="1" />
    </svg>
  );
}
