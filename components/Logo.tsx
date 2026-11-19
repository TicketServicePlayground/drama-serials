import Link from "next/link";
import { useId } from "react";

/** The mark: two episode cards, the front one with a play button. Same drawing as app/icon.svg. */
export function LogoMark({ className = "" }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={className}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FF2E7E" />
          <stop offset="1" stopColor="#FF8A3D" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${id})`} />
      <rect x="13" y="14" width="25" height="37" rx="6" fill="#fff" fillOpacity=".38" transform="rotate(-12 25.5 32.5)" />
      <rect x="23" y="11" width="27" height="42" rx="6.5" fill="#fff" />
      <path
        d="M32.5 24.2v15.6a1.4 1.4 0 0 0 2.1 1.2l12-7.8a1.4 1.4 0 0 0 0-2.4l-12-7.8a1.4 1.4 0 0 0-2.1 1.2Z"
        fill={`url(#${id})`}
      />
    </svg>
  );
}

export function Logo({ href, size = "md" }: { href: string; size?: "sm" | "md" }) {
  return (
    <Link
      href={href}
      aria-label="AN Serials"
      className="inline-flex shrink-0 items-center gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      <LogoMark className={size === "sm" ? "size-7" : "size-8 sm:size-9"} />
      <span
        aria-hidden
        className={`font-display leading-none tracking-[-0.02em] text-foreground ${
          size === "sm" ? "text-lg" : "text-xl sm:text-2xl"
        }`}
      >
        <span className="font-extrabold">AN</span> <span className="font-medium text-foreground/85">Serials</span>
      </span>
    </Link>
  );
}
