'use client';

import { useEffect, useRef } from 'react';
import { usePlaybackStore } from '@/stores';
import s from '../features.module.css';

interface Cube {
  x: number;
  y: number;
  size: number;
  depth: number;
  targetX: number;
  targetY: number;
  progress: number;
  duration: number;
  accent: boolean;
  hue: number;
}

/**
 * The hero background: large flat "pixels" that drift between grid
 * positions at different depths, on their own lightweight canvas.
 *
 * Deliberately NOT the shared GL stage — that budget belongs to asset
 * previews. This is plain 2D canvas, a handful of rectangles, and it stops
 * animating the moment it scrolls out of view.
 *
 * Per the design system's own rule ("accent on at most one element per
 * region"), only a small fraction of cubes ever carry the accent colour;
 * the rest stay in the gray/border tones so the grid below still reads as
 * the one accented thing on the page.
 */
function HeroCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /*
   * Read from the playback store rather than calling matchMedia here.
   * AppShell already subscribes to the OS preference and keeps this value
   * live via a change listener; this component used to check matchMedia
   * ONCE at mount and never again, so toggling the system setting mid-
   * session left the hero animating while every other surface correctly
   * stopped. One source, one listener, no way for the two to disagree.
   */
  const reduceMotion = usePlaybackStore((st) => st.reducedMotion);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let cubes: Cube[] = [];
    let raf = 0;
    let visible = true;

    const GRID = 8;
    const TONES = ['#16161a', '#1d1d22', '#232329', '#262629', '#35353a'];
    const ACCENT = '#00d3ff';

    function cell(gx: number, gy: number) {
      return { x: (gx / GRID) * width, y: (gy / GRID) * height };
    }

    function resize() {
      if (!canvas) return;
      const rect = canvas.parentElement!.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      build();
    }

    function build() {
      const count = 26;
      cubes = new Array(count).fill(null).map((_, i) => {
        const gx = Math.floor(Math.random() * GRID);
        const gy = Math.floor(Math.random() * GRID);
        const p = cell(gx, gy);
        const depth = 0.3 + Math.random() * 0.7;
        return {
          x: p.x,
          y: p.y,
          targetX: p.x,
          targetY: p.y,
          size: (width / GRID) * (0.35 + depth * 0.5),
          depth,
          progress: 1,
          duration: 4000 + Math.random() * 5000,
          // Roughly 1 in 14 carries the accent — texture, not decoration.
          accent: i % 14 === 0,
          hue: Math.random(),
        };
      });
    }

    function retarget(c: Cube) {
      const gx = Math.floor(Math.random() * GRID);
      const gy = Math.floor(Math.random() * GRID);
      const p = cell(gx, gy);
      c.x = c.targetX;
      c.y = c.targetY;
      c.targetX = p.x;
      c.targetY = p.y;
      c.progress = 0;
      c.duration = 4000 + Math.random() * 6000;
    }

    let last = performance.now();

    function frame(now: number) {
      raf = requestAnimationFrame(frame);
      if (!visible) return;

      const dt = now - last;
      last = now;

      ctx!.clearRect(0, 0, width, height);

      for (const c of cubes) {
        c.progress = Math.min(1, c.progress + dt / c.duration);
        // Ease in/out rather than linear, so drift never looks mechanical.
        const t = c.progress < 0.5 ? 2 * c.progress ** 2 : 1 - (-2 * c.progress + 2) ** 2 / 2;
        const x = c.x + (c.targetX - c.x) * t;
        const y = c.y + (c.targetY - c.y) * t;

        ctx!.globalAlpha = 0.25 + c.depth * 0.5;
        ctx!.fillStyle = c.accent ? ACCENT : TONES[Math.floor(c.hue * TONES.length)];
        ctx!.fillRect(x - c.size / 2, y - c.size / 2, c.size, c.size);

        if (c.progress >= 1) retarget(c);
      }
      ctx!.globalAlpha = 1;
    }

    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement!);
    resize();

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    io.observe(canvas);

    if (!reduceMotion) raf = requestAnimationFrame(frame);
    else build();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, [reduceMotion]);

  return <canvas ref={canvasRef} className={s.heroCanvas} aria-hidden="true" />;
}

export function Hero() {
  return (
    <section className={s.hero}>
      <HeroCanvas />
      <div className={s.heroFade} />
      <div className={s.heroContent}>
        <h1 className={s.heroTitle}>
          Visual Mood <span className={s.wordmarkAccent}>Lab</span>{' '}
          <span className={s.heroVersion}>v1.0</span>
        </h1>
        <p className={s.heroSub}>
          A board for shaders, sketches, and motion — not a gallery. Every asset here exposes
          real parameters you can tune, save as a new look, and come back to. Open anything below
          to start.
        </p>
      </div>
    </section>
  );
}
