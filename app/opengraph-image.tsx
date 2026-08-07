import { ImageResponse } from 'next/og';

/*
 * app/opengraph-image.tsx
 *
 * Next.js's file-convention: this route auto-generates the og:image (and,
 * absent a separate twitter-image file, the Twitter Card image too) for
 * every page under this segment — no <meta> tags to hand-wire, no static
 * asset to keep in sync by hand. Colours below are hardcoded hex, not
 * var(--token) references — ImageResponse renders through Satori, which
 * only understands literal values, not CSS custom properties. These are
 * copy-pasted straight from styles/tokens.css; if the palette changes
 * there, update here too.
 *
 * Deliberately not the actual DriftCanvas animation (it's a live canvas
 * loop, and this has to be a single static frame) — a few static
 * translucent squares evoke the same motif from the auth pages' hero
 * without trying to fake motion in a still image.
 */

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px',
          background: '#000000',
          position: 'relative',
        }}
      >
        {/* Static echo of the drifting-squares motif from AuthShell's hero —
            fixed, faint rectangles rather than an attempt at motion.
            Positions were hand-tuned against a rendered preview to clear
            the text block entirely — see the .png this file's history
            iterated against before landing here. */}
        <div
          style={{
            position: 'absolute',
            top: 50,
            right: 90,
            width: 170,
            height: 170,
            background: 'rgba(0, 211, 255, 0.13)',
            borderRadius: 4,
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 40,
            right: 280,
            width: 90,
            height: 90,
            background: 'rgba(255, 255, 255, 0.045)',
            borderRadius: 4,
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 230,
            right: 150,
            width: 70,
            height: 70,
            background: 'rgba(255, 255, 255, 0.04)',
            borderRadius: 4,
          }}
        />

        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <span
            style={{
              fontSize: 92,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              color: '#e8e8ea',
            }}
          >
            Visual Mood&nbsp;
          </span>
          <span
            style={{
              fontSize: 92,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              color: '#00d3ff',
            }}
          >
            Lab
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            marginTop: 4,
            fontSize: 26,
            color: '#45454c',
            letterSpacing: '0.02em',
          }}
        >
          v1.0
        </div>

        <div
          style={{
            display: 'flex',
            marginTop: 30,
            fontSize: 30,
            color: '#6e6e76',
            maxWidth: 760,
            lineHeight: 1.4,
          }}
        >
          A board for shaders, sketches, and motion — not a gallery.
        </div>
      </div>
    ),
    { ...size },
  );
}
