import { AnnotationLayer } from '../Annotation';
import { STEP4 } from '../content';
import s from '../onboarding.module.css';

export function Step4Inspector() {
  return (
    <>
      <div className={s.hero}>
        <div className={s.panelFrame} style={{ width: 372, height: 402 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className={s.panelImg}
            style={{ width: 370, height: 400 }}
            src="/onboarding/card4/panel.jpg"
            alt="Inspector panel: Colors group (Accent, Dim elements, Background swatches) and Global group (Scale slider)"
          />
          <AnnotationLayer
            items={[
              { nodeX: 175, nodeY: 89, chipX: 190, chipY: 72, label: 'Any color is editable', delay: 'd0' },
              { nodeX: 185, nodeY: 290, chipX: 197, chipY: 282, label: 'Sliders allow control', delay: 'd1' },
            ]}
          />
        </div>
      </div>
      <div className={s.body}>
        <h2 className={s.title}>{STEP4.title}</h2>
        <p className={s.copy}>{STEP4.bodyDesktop}</p>
      </div>
    </>
  );
}
