import type { ReactNode } from 'react';
import Image from 'next/image';
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
          <h1 className={s.wordmark} aria-label="Visual Mood Lab version 1.0">
            <Image src="/branding/vml-logo-main.svg" alt="" width={466} height={185} priority />
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
