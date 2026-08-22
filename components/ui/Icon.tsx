import type { SVGProps } from 'react';

/**
 * A small hand-rolled icon set. No icon library: at this count the dependency
 * costs more than the paths, and stroke weight can be tuned to the type scale.
 * All icons are 16×16 on a 1.25 stroke, which reads correctly against
 * --step--1 labels without looking heavy on black.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const MenuIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 4h12M2 8h12M2 12h12" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
  </Svg>
);

export const GridIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="2" width="5" height="5" rx="0.5" />
    <rect x="9" y="2" width="5" height="5" rx="0.5" />
    <rect x="2" y="9" width="5" height="5" rx="0.5" />
    <rect x="9" y="9" width="5" height="5" rx="0.5" />
  </Svg>
);

export const CanvasIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="3" width="6" height="4" rx="0.5" />
    <rect x="9.5" y="5" width="4.5" height="7" rx="0.5" />
    <rect x="2" y="9" width="5" height="4" rx="0.5" />
  </Svg>
);

export const PlayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 3l8 5-8 5z" fill="currentColor" strokeWidth={1} />
  </Svg>
);

export const PauseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 3v10M10.5 3v10" strokeWidth={1.5} />
  </Svg>
);

/** Speaker cone plus either sound-wave arcs or an X, same on/off-prop
    pattern as FullscreenIcon below. Used for the header master mute
    toggle (Phase 4.8, Stage 1). */
export const VolumeIcon = ({ muted, ...p }: IconProps & { muted?: boolean }) => (
  <Svg {...p}>
    <path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="currentColor" strokeWidth={1} />
    {muted ? (
      <path d="M10.5 6l3 4M13.5 6l-3 4" />
    ) : (
      <path d="M10.5 5.5a4 4 0 0 1 0 5M12.3 4a6.5 6.5 0 0 1 0 8" />
    )}
  </Svg>
);

export const SettingsIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="2.25" />
    <path d="M8 1.5v1.75M8 12.75v1.75M14.5 8h-1.75M3.25 8H1.5M12.6 3.4l-1.24 1.24M4.64 11.36L3.4 12.6M12.6 12.6l-1.24-1.24M4.64 4.64L3.4 3.4" />
  </Svg>
);

/**
 * Toggle glyph — arrows pointing out (enter fullscreen) vs. in (exit).
 * Shared between the desktop overlay (native Fullscreen API) and the
 * mobile focused view (CSS-only pseudo-fullscreen, since iOS Safari has no
 * Fullscreen API for arbitrary elements — see MobileFocusedView.tsx). Same
 * icon either way; only what the click handler does differs.
 */
export const FullscreenIcon = ({ on, ...p }: IconProps & { on?: boolean }) => (
  <Svg {...p}>
    {on ? (
      <path d="M6 2v2.5A1.5 1.5 0 0 1 4.5 6H2M10 2v2.5A1.5 1.5 0 0 0 11.5 6H14M6 14v-2.5A1.5 1.5 0 0 0 4.5 10H2M10 14v-2.5a1.5 1.5 0 0 1 1.5-1.5H14" />
    ) : (
      <path d="M2 6V3.5A1.5 1.5 0 0 1 3.5 2H6M14 6V3.5A1.5 1.5 0 0 0 12.5 2H10M2 10v2.5A1.5 1.5 0 0 0 3.5 14H6M14 10v2.5a1.5 1.5 0 0 1-1.5 1.5H10" />
    )}
  </Svg>
);

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="4.25" />
    <path d="M10.2 10.2L14 14" />
  </Svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...p} size={p.size ?? 12}>
    <path d="M3.5 6l4.5 4.5L12.5 6" />
  </Svg>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p} size={p.size ?? 12}>
    <path d="M6 3.5L10.5 8 6 12.5" />
  </Svg>
);

export const ResetIcon = (p: IconProps) => (
  <Svg {...p} size={p.size ?? 12}>
    <path d="M13 8a5 5 0 1 1-1.6-3.66" />
    <path d="M13 2v3h-3" />
  </Svg>
);

export const LayersIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 1.75L14.5 5.5 8 9.25 1.5 5.5z" />
    <path d="M2.5 8.5L8 11.75l5.5-3.25" />
    <path d="M2.5 11.25L8 14.5l5.5-3.25" />
  </Svg>
);

export const CodeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" />
  </Svg>
);

export const UploadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 10.5V2.5M4.75 5.75L8 2.5l3.25 3.25" />
    <path d="M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" />
  </Svg>
);

export const TagIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7.4 2H2.5v4.9l6.6 6.6a1 1 0 0 0 1.42 0l3.48-3.48a1 1 0 0 0 0-1.42z" />
    <circle cx="5.25" cy="4.75" r="0.9" />
  </Svg>
);

export const SlidersIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 4.5h5M10 4.5h4M2 11.5h4M9 11.5h5" />
    <circle cx="8.5" cy="4.5" r="1.5" />
    <circle cx="7.5" cy="11.5" r="1.5" />
  </Svg>
);
