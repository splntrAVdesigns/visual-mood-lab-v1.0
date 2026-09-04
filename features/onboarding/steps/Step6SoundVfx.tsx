import { AnnotationLayer } from '../Annotation';
import { STEP6 } from '../content';
import s from '../onboarding.module.css';

export function Step6SoundVfx() {
  return (
    <>
      <div className={s.hero}>
        <div className={s.panelFrame} style={{ width: 413, height: 402 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className={s.panelImg}
            style={{ width: 411, height: 400 }}
            src="/onboarding/card6/panel.jpg"
            alt="Sound drawer (Upload Audio, Mic, Meter) stacked above the VFX drawer (Add Effect)"
          />
          <AnnotationLayer
            items={[
              { nodeX: 16, nodeY: 162, chipX: 27, chipY: 154, label: 'Upload a track, or use your mic', delay: 'd0' },
              { nodeX: 16, nodeY: 303, chipX: 27, chipY: 294, label: 'Up to 3 effects per tile', delay: 'd1' },
            ]}
          />
        </div>
      </div>
      <div className={s.body}>
        <h2 className={s.title}>{STEP6.title}</h2>
        <p className={s.copy}>{STEP6.bodyDesktop}</p>
      </div>
    </>
  );
}
