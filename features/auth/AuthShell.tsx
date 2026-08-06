import type { ReactNode } from 'react';
import { DriftCanvas } from './DriftCanvas';
import s from './auth.module.css';

interface AuthShellProps {
  title: string;
  subtitle: string;
  children: ReactNode;
}

export function AuthShell({ title, subtitle, children }: AuthShellProps) {
  return (
    <div className={s.shell}>
      <div className={s.formPane}>
        <div className={s.formInner}>
          <h1 className={s.wordmark}>
            Visual Mood <span className={s.wordmarkAccent}>Lab</span>{' '}
            <span className={s.wordmarkVersion}>v1.0</span>
          </h1>

          <h2 className={s.pageTitle}>{title}</h2>
          <p className={s.subtitle}>{subtitle}</p>

          {children}
        </div>

        <p className={s.siteFooter}>Made by SPLNTR Micro Tools</p>
      </div>

      <div className={s.heroPane}>
        <DriftCanvas />
        <div className={s.heroFade} />
      </div>
    </div>
  );
}
