import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Visual Mood Lab',
  description:
    'A mood board for shaders, sketches, and motion. Every asset exposes parameters you can tune.',
};

export const viewport: Viewport = {
  themeColor: '#000000',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  /*
   * Zoom is deliberately NOT capped. `maximumScale: 1` was here on the
   * reasoning that the board is a fixed app surface rather than a
   * document — but blocking pinch-zoom fails WCAG 1.4.4 and locks out
   * anyone who needs to magnify to read a control label. That was a
   * largely theoretical cost while this was desktop-only; with a real
   * mobile layout it becomes an actual barrier for actual people.
   *
   * The layout does not need the cap: the focused view sizes off dvh and
   * the sheet scrolls, so zooming degrades gracefully rather than
   * breaking anything.
   */
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
