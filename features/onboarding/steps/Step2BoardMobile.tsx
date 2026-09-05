import { AnnotationLayer } from '../Annotation';
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
        <AnnotationLayer
          items={[
            { nodeX: 60, nodeY: 46, chipX: 70, chipY: 38, label: 'Recently viewed', delay: 'd0' },
            { nodeX: 37, nodeY: 108, chipX: 47, chipY: 100, label: 'Library uploads', delay: 'd1' },
            { nodeX: 52, nodeY: 171, chipX: 62, chipY: 163, label: 'Saved snapshots', delay: 'd2' },
          ]}
        />
      </div>
      <div className={s.body} style={{ paddingTop: 12 }}>
        <h2 className={s.title} style={{ fontSize: 18 }}>
          {STEP2.title}
        </h2>
        <p className={s.copy} style={{ fontSize: 13.5 }}>
          {STEP2.bodyMobile}
        </p>
      </div>
    </>
  );
}
