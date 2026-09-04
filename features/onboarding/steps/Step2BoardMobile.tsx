import { STEP2 } from '../content';
import s from '../onboarding.module.css';

export function Step2BoardMobile() {
  return (
    <>
      <div className={s.hero} style={{ height: 260, margin: '0 -18px', width: 'calc(100% + 36px)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={s.heroImg}
          src="/onboarding/card2/hero-mobile.jpg"
          alt="Board rows: Recently viewed, Library uploads, and Saved snapshots"
        />
      </div>
      <div className={s.body} style={{ paddingTop: 12 }}>
        <h2 className={s.title} style={{ fontSize: 18 }}>
          {STEP2.title}
        </h2>
        <p className={s.copy} style={{ fontSize: 13.5 }}>
          {STEP2.body}
        </p>
      </div>
    </>
  );
}
