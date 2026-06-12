"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

interface DeveloperLogoMarkProps {
  size?: number;
  className?: string;
  /** Subtle idle animation on the outer ring */
  animated?: boolean;
}

/**
 * Premium developer mark — layered prism + code bracket H.
 * Vector-only; scales cleanly at any size.
 */
export function DeveloperLogoMark({
  size = 48,
  className,
  animated = true,
}: DeveloperLogoMarkProps) {
  const uid = useId().replace(/:/g, "");
  const gradMain = `dev-logo-main-${uid}`;
  const gradGlow = `dev-logo-glow-${uid}`;
  const gradShine = `dev-logo-shine-${uid}`;
  const gradFace = `dev-logo-face-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      role="img"
      aria-label="Haidar Hazem Almusawi"
    >
      <defs>
        <linearGradient id={gradMain} x1="8" y1="4" x2="56" y2="60">
          <stop offset="0%" stopColor="#003875" />
          <stop offset="38%" stopColor="#0056b3" />
          <stop offset="72%" stopColor="#0d9488" />
          <stop offset="100%" stopColor="#0891b2" />
        </linearGradient>
        <linearGradient id={gradGlow} x1="0" y1="0" x2="64" y2="64">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0.15" />
        </linearGradient>
        <linearGradient id={gradShine} x1="16" y1="8" x2="48" y2="40">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={gradFace} x1="20" y1="18" x2="44" y2="46">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#e0f2fe" />
        </linearGradient>
        <filter id={`dev-logo-shadow-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#0056b3" floodOpacity="0.35" />
        </filter>
      </defs>

      {/* Ambient orbit */}
      <circle
        cx="32"
        cy="32"
        r="30"
        stroke={`url(#${gradGlow})`}
        strokeWidth="1.25"
        fill="none"
        className={animated ? "origin-center animate-[spin_18s_linear_infinite]" : undefined}
        style={{ transformOrigin: "32px 32px" }}
        opacity="0.9"
      />

      {/* Core squircle */}
      <path
        d="M32 6 C44.5 6 54.5 10.5 56.5 18.5 C58.5 26.5 58.5 37.5 56.5 45.5 C54.5 53.5 44.5 58 32 58 C19.5 58 9.5 53.5 7.5 45.5 C5.5 37.5 5.5 26.5 7.5 18.5 C9.5 10.5 19.5 6 32 6 Z"
        fill={`url(#${gradMain})`}
        filter={`url(#dev-logo-shadow-${uid})`}
      />

      {/* Glass highlight */}
      <path
        d="M32 8 C43 8 51.5 12 53 18.5 C54 23 54 28 52.5 32 C48 22 40 14 32 12 C24 14 16 22 11.5 32 C10 28 10 23 11 18.5 C12.5 12 21 8 32 8 Z"
        fill={`url(#${gradShine})`}
      />

      {/* Isometric depth layer */}
      <path
        d="M46 44 L52 40 L52 24 L46 28 Z"
        fill="#003875"
        fillOpacity="0.35"
      />
      <path
        d="M18 44 L46 44 L52 40 L24 40 Z"
        fill="#002952"
        fillOpacity="0.28"
      />

      {/* Code-bracket H monogram */}
      <g fill={`url(#${gradFace})`}>
        {/* Left brace */}
        <path
          d="M19 22 C17.2 22 16 23.4 16 25.2 V27.2 C16 28.2 15.4 28.8 14.4 28.8 C13.4 28.8 12.8 29.4 12.8 30.4 C12.8 31.4 13.4 32 14.4 32 C15.4 32 16 32.6 16 33.6 V35.6 C16 37.4 17.2 38.8 19 38.8"
          stroke={`url(#${gradFace})`}
          strokeWidth="2.35"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        {/* Right brace */}
        <path
          d="M45 22 C46.8 22 48 23.4 48 25.2 V27.2 C48 28.2 48.6 28.8 49.6 28.8 C50.6 28.8 51.2 29.4 51.2 30.4 C51.2 31.4 50.6 32 49.6 32 C48.6 32 48 32.6 48 33.6 V35.6 C48 37.4 46.8 38.8 45 38.8"
          stroke={`url(#${gradFace})`}
          strokeWidth="2.35"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        {/* H stems */}
        <rect x="23.5" y="21" width="3.2" height="19" rx="1.6" />
        <rect x="37.3" y="21" width="3.2" height="19" rx="1.6" />
        {/* H crossbar — precision angle */}
        <path
          d="M26.7 30.5 H37.3"
          stroke={`url(#${gradFace})`}
          strokeWidth="3.2"
          strokeLinecap="round"
        />
      </g>

      {/* Center craft gem */}
      <path
        d="M32 28.2 L34.1 31.2 L32 34.2 L29.9 31.2 Z"
        fill="#67e8f9"
        stroke="#ffffff"
        strokeWidth="0.75"
        strokeLinejoin="round"
      />

      {/* Micro spark */}
      <circle cx="32" cy="31.2" r="1.1" fill="#ffffff" fillOpacity="0.95" />
    </svg>
  );
}
