import { AnnotationLayer } from '../Annotation';
import { STEP5 } from '../content';
import s from '../onboarding.module.css';

export function Step5ModulationMobile() {
  return (
    <>
      <div className={s.hero} style={{ height: 320, margin: '0 -18px', width: 'calc(100% + 36px)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/onboarding/card5/hero-mobile.jpg"
          alt="Modulate tab: Source (LFO — Sine), Amount, and Rate"
          style={{
            position: 'absolute',
            top: 34,
            left: 0,
            width: 360,
            height: 281,
            objectFit: 'cover',
            display: 'block',
          }}
        />
        <AnnotationLayer
          items={[
            { nodeX: 15, nodeY: 133, chipX: 25, chipY: 125, label: 'Choose what drives it', delay: 'd0' },
            { nodeX: 15, nodeY: 218, chipX: 25, chipY: 210, label: 'Sync to tempo or set Hz', delay: 'd1' },
          ]}
        />
      </div>
      <div className={s.body} style={{ paddingTop: 12 }}>
        <h2 className={s.title} style={{ fontSize: 18 }}>
          {STEP5.title}
        </h2>
        <p className={s.copy} style={{ fontSize: 13.5 }}>
          {STEP5.bodyMobile}
        </p>
      </div>
    </>
  );
}
