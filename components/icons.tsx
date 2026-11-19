import type { SVGProps } from "react";

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export const HomeIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base} fill="currentColor" stroke="none" {...props}>
    <path d="M12 3.2 3 10.6V20a1 1 0 0 0 1 1h5.5v-5.5h5V21H20a1 1 0 0 0 1-1v-9.4L12 3.2Z" />
  </svg>
);
export const PlayIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...props}>
    <rect x="3.5" y="5" width="17" height="14" rx="3" />
    <path d="m10.5 9.5 4 2.5-4 2.5v-5Z" fill="currentColor" />
  </svg>
);
export const CrownIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...props}>
    <path d="m4 8 4 4 4-6 4 6 4-4-1.5 10h-13L4 8Z" />
  </svg>
);
export const BookmarkIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...props}>
    <path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1Z" />
  </svg>
);
export const UserIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...props}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 20c.8-3.5 3.6-5.5 7-5.5s6.2 2 7 5.5" />
  </svg>
);
export const ChevronIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...props}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);
export const BackIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...props}>
    <path d="m14.5 5-7 7 7 7" />
  </svg>
);
export const LockIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...props}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </svg>
);
export const EyeIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...props}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
export const HeartIcon = ({ filled, ...props }: SVGProps<SVGSVGElement> & { filled?: boolean }) => (
  <svg {...base} fill={filled ? "currentColor" : "none"} {...props}>
    <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z" />
  </svg>
);
export const BookmarkFilledIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base} fill="currentColor" {...props}>
    <path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1Z" />
  </svg>
);
export const FilmIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...props}>
    <rect x="6" y="3.5" width="12" height="17" rx="2.5" />
    <path d="m10.5 9.5 3.5 2.5-3.5 2.5v-5Z" fill="currentColor" />
  </svg>
);
export const ClockIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);
export const SearchIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...props}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </svg>
);
export const CloseIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base} {...props}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
