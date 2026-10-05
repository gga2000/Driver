import type { ReactNode, SVGProps } from 'react';

/**
 * The Console's icon set: 20-px grid, 1.6 stroke, round caps — drawn for this tool, no icon font.
 * Directional icons are drawn for RTL already (back points right, send points left). Decorative by
 * default (`aria-hidden`); pass `title` for a standalone meaning.
 */

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  size?: number;
  title?: string;
};

function Svg({ size = 18, title, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

const make = (paths: ReactNode) =>
  function Icon(p: IconProps) {
    return <Svg {...p}>{paths}</Svg>;
  };

export const IconMap = make(
  <>
    <path d="M7 3.5 2.5 5.2v11.3L7 14.8l6 1.7 4.5-1.7V3.5L13 5.2 7 3.5Z" />
    <path d="M7 3.5v11.3M13 5.2v11.3" />
  </>,
);
export const IconDispatch = make(
  <>
    <circle cx="5" cy="5" r="2" />
    <circle cx="15" cy="15" r="2" />
    <path d="M7 5h4.5a3 3 0 0 1 0 6h-3a3 3 0 0 0 0 6H13" />
  </>,
);
export const IconOrders = make(
  <>
    <path d="M5 2.5h10v15l-2.5-1.5L10 17.5 7.5 16 5 17.5v-15Z" />
    <path d="M7.5 6.5h5M7.5 9.5h5M7.5 12.5h3" />
  </>,
);
export const IconDrivers = make(
  <>
    <circle cx="5" cy="14" r="2.75" />
    <circle cx="15" cy="14" r="2.75" />
    <path d="M5 14h4l3-6h2.5M9 8h3M14.5 8 15 14" />
  </>,
);
export const IconSupport = make(
  <>
    <path d="M16.5 10.5a6.5 6.5 0 1 1-2.2-4.9" />
    <path d="M3.5 10.5v-1a6.5 6.5 0 0 1 13 0v1" />
    <rect x="2.5" y="10" width="3" height="4.5" rx="1.2" />
    <rect x="14.5" y="10" width="3" height="4.5" rx="1.2" />
    <path d="M16 14.5c0 1.6-1.6 2.5-4 2.5" />
  </>,
);
export const IconApprovals = make(
  <>
    <path d="M10 2.5 16 5v4.5c0 3.8-2.6 6.6-6 8-3.4-1.4-6-4.2-6-8V5l6-2.5Z" />
    <path d="m7.2 10 2 2 3.6-4" />
  </>,
);
export const IconCash = make(
  <>
    <rect x="2.5" y="5" width="15" height="10" rx="2" />
    <circle cx="10" cy="10" r="2.2" />
    <path d="M5.5 8v4M14.5 8v4" />
  </>,
);
export const IconPricing = make(
  <>
    <path d="M10.6 2.5H16a1.5 1.5 0 0 1 1.5 1.5v5.4L9.4 17.5a1.5 1.5 0 0 1-2.1 0l-4.8-4.8a1.5 1.5 0 0 1 0-2.1l8.1-8.1Z" />
    <circle cx="13.5" cy="6.5" r="1.2" />
  </>,
);
export const IconControls = make(
  <>
    <rect x="2.5" y="4" width="15" height="5" rx="2.5" />
    <circle cx="13" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
    <rect x="2.5" y="11" width="15" height="5" rx="2.5" />
    <circle cx="7" cy="13.5" r="1.2" fill="currentColor" stroke="none" />
  </>,
);
export const IconWall = make(
  <>
    <rect x="2.5" y="3.5" width="15" height="10" rx="1.5" />
    <path d="M7 17h6M10 13.5V17" />
    <path d="m5.5 10.5 2.5-2.5 2 1.5 3.5-3.5" />
  </>,
);
export const IconSystem = make(
  <>
    <rect x="3" y="3" width="14" height="5.5" rx="1.5" />
    <rect x="3" y="11.5" width="14" height="5.5" rx="1.5" />
    <path d="M6 5.75h.01M6 14.25h.01" strokeWidth={2.2} />
  </>,
);
export const IconZones = make(
  <>
    <path d="M4 6.5 9 3l6.5 2.5L17 11l-4 5.5-7-1L3 11z" />
    <circle cx="10" cy="10" r="1.3" fill="currentColor" stroke="none" />
  </>,
);
export const IconSearch = make(
  <>
    <circle cx="9" cy="9" r="5.5" />
    <path d="m13 13 4 4" />
  </>,
);
export const IconSun = make(
  <>
    <circle cx="10" cy="10" r="3.2" />
    <path d="M10 2.5v1.5M10 16v1.5M2.5 10H4M16 10h1.5M4.7 4.7l1.1 1.1M14.2 14.2l1.1 1.1M4.7 15.3l1.1-1.1M14.2 5.8l1.1-1.1" />
  </>,
);
export const IconMoon = make(<path d="M15.8 12.2A6.5 6.5 0 0 1 7.8 4.2a6.5 6.5 0 1 0 8 8Z" />);
export const IconDensity = make(<path d="M3.5 5h13M3.5 8.3h13M3.5 11.7h13M3.5 15h13" />);
export const IconChevronDown = make(<path d="m5.5 8 4.5 4.5L14.5 8" />);
/** Points to the start edge in RTL (right): "back". */
export const IconBack = make(<path d="M8 4.5 13.5 10 8 15.5" />);
/** Points to the end edge in RTL (left): "forward / open". */
export const IconForward = make(<path d="M12 4.5 6.5 10l5.5 5.5" />);
export const IconClose = make(<path d="m5 5 10 10M15 5 5 15" />);
export const IconCheck = make(<path d="m4.5 10.5 3.5 3.5 7.5-8" />);
export const IconPlus = make(<path d="M10 4v12M4 10h12" />);
export const IconPhone = make(
  <path d="M6.6 3H4.5A1.5 1.5 0 0 0 3 4.6C3.3 11 9 16.7 15.4 17a1.5 1.5 0 0 0 1.6-1.5v-2.1a1 1 0 0 0-.7-1l-2.6-.9a1 1 0 0 0-1.1.3l-1 1.2a10 10 0 0 1-4.6-4.6l1.2-1a1 1 0 0 0 .3-1.1l-.9-2.6a1 1 0 0 0-1-.7Z" />,
);
/** A chat bubble with a tail: WhatsApp and other messaging channels (no third-party logo). */
export const IconChat = make(
  <>
    <path d="M10 3a7 7 0 0 0-6 10.6L3 17l3.5-1A7 7 0 1 0 10 3Z" />
    <path d="M7 9.5h.01M10 9.5h.01M13 9.5h.01" strokeWidth={2.2} />
  </>,
);
export const IconApp = make(
  <>
    <rect x="5.5" y="2.5" width="9" height="15" rx="2" />
    <path d="M9 15h2" />
  </>,
);
export const IconCog = make(
  <>
    <circle cx="10" cy="10" r="2.5" />
    <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" />
  </>,
);
export const IconLock = make(
  <>
    <rect x="4" y="9" width="12" height="8.5" rx="1.8" />
    <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
  </>,
);
export const IconPaperclip = make(
  <path d="m15.5 9.5-5.8 5.8a3.5 3.5 0 0 1-5-5l6.2-6.2a2.3 2.3 0 0 1 3.3 3.3l-6.1 6.1a1.2 1.2 0 0 1-1.7-1.7L12 6.2" />,
);
/** Paper plane pointing to the end edge (left in RTL). */
export const IconSend = make(
  <>
    <path d="M17 3 3 9.2l5.3 2.1L10.5 17 17 3Z" />
    <path d="m8.3 11.3 3.2-3.2" />
  </>,
);
export const IconNote = make(
  <>
    <path d="M4 3.5h12v8.5l-4.5 4.5H4v-13Z" />
    <path d="M11.5 16.5V12H16M7 7h6M7 9.5h3.5" />
  </>,
);
export const IconBulb = make(
  <>
    <path d="M7.5 14.5h5M8 17h4" />
    <path d="M10 2.5a5 5 0 0 0-3 9c.6.5 1 1.2 1 2V14h4v-.5c0-.8.4-1.5 1-2a5 5 0 0 0-3-9Z" />
  </>,
);
export const IconRefund = make(
  <>
    <path d="M4 8h9a4 4 0 0 1 0 8H8" />
    <path d="m7 5-3 3 3 3" />
  </>,
);
export const IconFlag = make(
  <>
    <path d="M4.5 17.5v-14" />
    <path d="M4.5 3.5h10l-2 3.5 2 3.5h-10" />
  </>,
);
export const IconArrowUp = make(<path d="M10 16V4M5 9l5-5 5 5" />);
export const IconCheckCircle = make(
  <>
    <circle cx="10" cy="10" r="7" />
    <path d="m7 10.2 2 2 4-4.2" />
  </>,
);
export const IconClock = make(
  <>
    <circle cx="10" cy="10" r="7" />
    <path d="M10 6v4l2.5 2" />
  </>,
);
export const IconUser = make(
  <>
    <circle cx="10" cy="7" r="3.2" />
    <path d="M3.5 17a6.5 6.5 0 0 1 13 0" />
  </>,
);
export const IconStore = make(
  <>
    <path d="M3 8h14l-1.2-4.5H4.2L3 8Z" />
    <path d="M4 8v8.5h12V8M8 16.5V12h4v4.5" />
  </>,
);
export const IconAlert = make(
  <>
    <path d="M10 3 2.5 16.5h15L10 3Z" />
    <path d="M10 8v3.5M10 14h.01" />
  </>,
);
export const IconInbox = make(
  <>
    <path d="M2.5 11.5 5 4h10l2.5 7.5V16H2.5v-4.5Z" />
    <path d="M2.5 11.5h4l1 2h5l1-2h4" />
  </>,
);
export const IconKeyboard = make(
  <>
    <rect x="2" y="5" width="16" height="10" rx="2" />
    <path d="M5 8h.01M8 8h.01M11 8h.01M14 8h.01M5.5 12h9" strokeWidth={1.8} />
  </>,
);
export const IconSidebar = make(
  <>
    <rect x="2.5" y="3.5" width="15" height="13" rx="2" />
    <path d="M12.5 3.5v13" />
  </>,
);
export const IconLogout = make(
  <>
    <path d="M8 3.5H4.5v13H8" />
    <path d="M11 6.5 7.5 10l3.5 3.5M7.5 10h9" />
  </>,
);
export const IconFilter = make(<path d="M3 4.5h14l-5.5 6.5v5l-3-1.5V11L3 4.5Z" />);
export const IconCopy = make(
  <>
    <rect x="7" y="7" width="10" height="10" rx="1.8" />
    <path d="M13 7V4.8A1.8 1.8 0 0 0 11.2 3H4.8A1.8 1.8 0 0 0 3 4.8v6.4A1.8 1.8 0 0 0 4.8 13H7" />
  </>,
);
export const IconBolt = make(<path d="M11 2.5 4.5 11h5l-1 6.5L15 9h-5l1-6.5Z" />);
export const IconExternal = make(
  <>
    <path d="M8.5 4H4.5v11.5H16v-4" />
    <path d="M11.5 3.5H16.5v5M16.5 3.5 9.5 10.5" />
  </>,
);
export const IconBell = make(
  <>
    <path d="M5 13.5V9a5 5 0 0 1 10 0v4.5l1.5 2h-13l1.5-2Z" />
    <path d="M8.3 17.5a1.9 1.9 0 0 0 3.4 0" />
  </>,
);
export const IconShield = make(
  <path d="M10 2.5 16 5v4.5c0 3.8-2.6 6.6-6 8-3.4-1.4-6-4.2-6-8V5l6-2.5Z" />,
);
/** A stop sign: something switched off on purpose (kill switches). */
export const IconStop = make(
  <>
    <path d="M7 2.5h6L17.5 7v6L13 17.5H7L2.5 13V7L7 2.5Z" />
    <path d="M7 10h6" />
  </>,
);
export const IconDownload = make(
  <>
    <path d="M10 3v10M6 9l4 4 4-4" />
    <path d="M3.5 14.5v2h13v-2" />
  </>,
);
export const IconPin = make(
  <>
    <path d="M10 17.5s5.5-5 5.5-9.5a5.5 5.5 0 0 0-11 0c0 4.5 5.5 9.5 5.5 9.5Z" />
    <circle cx="10" cy="8" r="2" />
  </>,
);
export const IconTarget = make(
  <>
    <circle cx="10" cy="10" r="7" />
    <circle cx="10" cy="10" r="3.5" />
  </>,
);
export const IconZoom = make(
  <>
    <circle cx="9" cy="9" r="5.5" />
    <path d="m13 13 4 4M9 6.5v5M6.5 9h5" />
  </>,
);
export const IconDot = ({ className = '' }: { className?: string }) => (
  <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-pill ${className}`} />
);
