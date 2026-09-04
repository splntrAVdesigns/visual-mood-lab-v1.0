import { STEP1 } from '../content';
import s from '../onboarding.module.css';

export function Step1Welcome() {
  return (
    <>
      <div className={s.hero}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={s.heroImg}
          src="/onboarding/card1/hero.jpg"
          alt="Visual Mood Lab board header, showing the wordmark, welcome copy, and a row of Recently Viewed tiles"
        />
      </div>
      <div className={s.body}>
        <h2 className={s.title}>{STEP1.title}</h2>
        <p className={s.copy}>{STEP1.body}</p>
      </div>
    </>
  );
}
