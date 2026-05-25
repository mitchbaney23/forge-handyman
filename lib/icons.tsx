import type { SVGProps } from "react";

type IconName =
  | "wrench"
  | "saw"
  | "brush"
  | "fence"
  | "lightbulb"
  | "box"
  | "spray"
  | "panel"
  | "shield"
  | "hammer"
  | "home"
  | "star"
  | "tag"
  | "phone"
  | "mail"
  | "clock"
  | "map-pin"
  | "check"
  | "arrow-right"
  | "menu"
  | "close"
  | "calendar"
  | "dollar"
  | "handshake"
  | "camera"
  | "spinner";

type IconProps = SVGProps<SVGSVGElement> & { name: IconName };

const PATHS: Record<IconName, React.ReactNode> = {
  wrench: (
    <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.7 2.7-2.3-.4-.4-2.3 2.7-2.7z" />
  ),
  saw: (
    <>
      <path d="M3 10h14l4 4v4H5l-2-2v-6z" />
      <path d="M5 10V6h12" />
      <path d="m7 6 2-2m2 2 2-2m2 2 2-2" />
    </>
  ),
  brush: (
    <>
      <path d="M9 21a3 3 0 0 1-3-3V9h10v9a3 3 0 0 1-3 3H9z" />
      <path d="M6 9V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v4" />
      <path d="M10 14h4" />
    </>
  ),
  fence: (
    <>
      <path d="M4 21V7l2-3 2 3v14" />
      <path d="M12 21V7l2-3 2 3v14" />
      <path d="M4 10h16M4 16h16" />
    </>
  ),
  lightbulb: (
    <>
      <path d="M9 18h6m-5 3h4" />
      <path d="M12 3a6 6 0 0 0-4 10.5c.8.8 1.2 1.7 1.2 2.8V17h5.6v-.7c0-1.1.4-2 1.2-2.8A6 6 0 0 0 12 3z" />
    </>
  ),
  box: (
    <>
      <path d="M21 8 12 3 3 8l9 5 9-5z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
    </>
  ),
  spray: (
    <>
      <path d="M9 10h6v11H9z" />
      <path d="M10 10V5h4v5" />
      <path d="M16 4h3m-3 3h2m-2 3h3" />
    </>
  ),
  panel: (
    <>
      <path d="M3 5h18v14H3z" />
      <path d="M9 5v14M15 5v14M3 12h18" />
    </>
  ),
  shield: <path d="M12 3 5 6v6c0 4.5 3 8.5 7 9 4-.5 7-4.5 7-9V6l-7-3z" />,
  hammer: (
    <>
      <path d="m14 3 7 7-4 4-7-7 4-4z" />
      <path d="m10 10-7 7 3 3 7-7" />
    </>
  ),
  home: <path d="M3 11 12 3l9 8v10h-6v-6h-6v6H3V11z" />,
  star: (
    <path d="m12 3 3 6 6.5 1-4.7 4.6 1.1 6.4L12 18l-5.9 3 1.1-6.4L2.5 10 9 9l3-6z" />
  ),
  tag: (
    <>
      <path d="M3 12V3h9l9 9-9 9-9-9z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </>
  ),
  phone: (
    <path d="M5 3h4l2 5-3 2a11 11 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z" />
  ),
  mail: (
    <>
      <path d="M3 6h18v12H3z" />
      <path d="m3 6 9 7 9-7" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  "map-pin": (
    <>
      <path d="M12 22s7-7.5 7-13a7 7 0 0 0-14 0c0 5.5 7 13 7 13z" />
      <circle cx="12" cy="9" r="2.5" />
    </>
  ),
  check: <path d="m5 12 5 5 9-10" />,
  "arrow-right": <path d="M5 12h14m-6-6 6 6-6 6" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  calendar: (
    <>
      <path d="M4 6h16v14H4z" />
      <path d="M4 10h16M8 4v4M16 4v4" />
    </>
  ),
  dollar: (
    <>
      <path d="M12 3v18" />
      <path d="M16 7H10a2.5 2.5 0 0 0 0 5h4a2.5 2.5 0 0 1 0 5H8" />
    </>
  ),
  handshake: (
    <path d="M3 12 7 8l3 3 3-3 4 4-3 3 1 2-2 2-3-3-3 3-2-2 1-2-3-3z" />
  ),
  camera: (
    <>
      <path d="M4 8h3l2-2h6l2 2h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  spinner: (
    <>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </>
  ),
};

export function Icon({ name, className, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      {PATHS[name]}
    </svg>
  );
}

export type { IconName };
