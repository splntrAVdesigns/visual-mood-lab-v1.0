import type { Metadata } from 'next';
import { AboutHero } from '@/features/about/AboutHero';
import { QuadrantSection } from '@/features/about/QuadrantSection';

export const metadata: Metadata = {
  title: 'About — Visual Mood Lab',
};

export default function AboutPage() {
  return (
    <main>
      <AboutHero />
      <QuadrantSection />
    </main>
  );
}
