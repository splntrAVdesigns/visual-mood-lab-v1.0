import { AnnotationLayer } from '../Annotation';
import { STEP4 } from '../content';
import s from '../onboarding.module.css';

export function Step4InspectorMobile() {
  return (
    <>
      <div className={s.hero} style={{ height: 320, margin: '0 -18px', width: 'calc(100% + 36px)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/onboarding/card4/hero-mobile.jpg"
          alt="Parameters tab: Color C, Gap color swatches, and Show advanced"
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
            { nodeX: 180, nodeY: 27, chipX: 99, chipY: 4, label: 'Tap tabs to enter section', delay: 'd0' },
            { nodeX: 15, nodeY: 132, chipX: 30, chipY: 124, label: 'Tap to edit', delay: 'd1' },
            { nodeX: 15, nodeY: 218, chipX: 30, chipY: 207, label: 'More in Show advanced', delay: 'd2' },
          ]}
        />
      </div>
      <div className={s.body} style={{ paddingTop: 12 }}>
        <h2 className={s.title} style={{ fontSize: 18 }}>
          {STEP4.title}
        </h2>
        <p className={s.copy} style={{ fontSize: 13.5 }}>
          {STEP4.bodyMobile}
        </p>
      </div>
    </>
  );
}
