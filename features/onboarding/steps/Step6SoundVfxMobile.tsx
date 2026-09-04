import { AnnotationLayer } from '../Annotation';
import { STEP6 } from '../content';
import s from '../onboarding.module.css';

export function Step6SoundVfxMobile() {
  return (
    <>
      <div className={s.hero} style={{ height: 350, margin: '0 -18px', width: 'calc(100% + 36px)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/onboarding/card6/hero-mobile.jpg"
          alt="Sounds tab (Upload Audio, Mic, Meter) above the VFX tab (Add Effect)"
          style={{
            position: 'absolute',
            top: 5,
            left: 0,
            width: 360,
            height: 340,
            objectFit: 'cover',
            display: 'block',
          }}
        />
        <AnnotationLayer
          items={[
            { nodeX: 15, nodeY: 144, chipX: 25, chipY: 136, label: 'Upload a track, or use your mic', delay: 'd0' },
            { nodeX: 15, nodeY: 220, chipX: 25, chipY: 212, label: 'Up to 3 effects per tile', delay: 'd1' },
          ]}
        />
      </div>
      <div className={s.body} style={{ paddingTop: 12 }}>
        <h2 className={s.title} style={{ fontSize: 18 }}>
          {STEP6.title}
        </h2>
        <p className={s.copy} style={{ fontSize: 13.5 }}>
          {STEP6.bodyMobile}
        </p>
      </div>
    </>
  );
}
