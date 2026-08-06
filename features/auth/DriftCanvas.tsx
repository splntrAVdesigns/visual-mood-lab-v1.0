'use client';

// features/auth/DriftCanvas.tsx
//
// This is a direct port of features/board/Hero.tsx's HeroCanvas — same
// drift logic, same tones, same accent ratio — reshaped for a full-height
// vertical pane instead of a 320px horizontal strip. It intentionally
// reuses the real component's visual language rather than the earlier
// WebGL shader experiment, which didn't match the app.
//
// Deliberately plain 2D canvas, outside the renderer pool, same as the
// original — this budget belongs to asset previews, not chrome.

import { useEffect, useRef } from 'react';
import { usePlaybackStore } from '@/stores';
import s from './auth.module.css';

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

export function DriftCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
      const nextWidth = rect.width;
      const nextHeight = rect.height;

      // ResizeObserver fires on subpixel/no-op changes too (font loading,
      // scrollbar appearance, sibling content reflowing), and this handler
      // is not cheap: canvas.width/height assignment fully clears and
      // reallocates the backing bitmap, and build() reshuffles all 26
      // particles with fresh Math.random() targets. Without this guard,
      // anything that nudges layout on an auth page — an error message
      // appearing, a field growing by a line — re-triggers both on every
      // firing, which is what made the page feel heavy specifically while
      // interacting with the form rather than just sitting on the page.
      if (Math.abs(nextWidth - width) < 1 && Math.abs(nextHeight - height) < 1) return;

      width = nextWidth;
      height = nextHeight;
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
