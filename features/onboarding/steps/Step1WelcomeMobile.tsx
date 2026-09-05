import { STEP1 } from '../content';
import s from '../onboarding.module.css';

export function Step1WelcomeMobile() {
  return (
    <>
      <div className={s.hero} style={{ height: 236, margin: '0 -18px', width: 'calc(100% + 36px)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={s.heroImg}
          src="/onboarding/card1/hero-mobile.jpg"
          alt="Visual Mood Lab board header, showing the wordmark, welcome copy, and a row of Recently Viewed tiles"
        />
      </div>
      <div className={s.body} style={{ paddingTop: 12 }}>
        <h2 className={s.title} style={{ fontSize: 18 }}>
          {STEP1.title}
        </h2>
        <p className={s.copy} style={{ fontSize: 13.5 }}>
          {STEP1.body}
        </p>
      </div>
    </>
  );
}
