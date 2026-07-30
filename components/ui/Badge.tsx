import type { ReactNode } from 'react';
import { cx } from './Button';
import s from './ui.module.css';

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx(s.badge, className)}>{children}</span>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className={s.sectionLabel}>{children}</div>;
}

export function Divider() {
  return <hr className={s.divider} />;
}
