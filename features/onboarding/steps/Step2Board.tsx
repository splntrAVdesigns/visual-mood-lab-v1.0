import { AnnotationLayer } from '../Annotation';
import { STEP2 } from '../content';
import s from '../onboarding.module.css';

export function Step2Board() {
  return (
    <>
      <div className={s.hero}>
        <div className={s.diptych}>
          <div className={s.diptychLeft}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className={s.diptychImg}
              src="/onboarding/card2/board-panel.jpg"
              alt="Board rows: Recently viewed, Library uploads, and Saved snapshots"
            />
            <AnnotationLayer
              items={[
                { nodeX: 44, nodeY: 47, chipX: 55, chipY: 38, label: 'Recently viewed', delay: 'd0' },
                { nodeX: 44, nodeY: 132, chipX: 55, chipY: 123, label: 'Library uploads', delay: 'd1' },
                { nodeX: 44, nodeY: 197, chipX: 55, chipY: 188, label: 'Saved snapshots', delay: 'd2' },
              ]}
            />
          </div>
          <div className={s.diptychRight}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className={s.diptychImg}
              src="/onboarding/card2/drawer-panel.jpg"
              alt="Left panel drawer, showing About, All assets filter, and type filters"
            />
            <AnnotationLayer
              items={[
                { nodeX: 14, nodeY: 27, chipX: 25, chipY: 18, label: 'Guide lives here', delay: 'd3' },
                { nodeX: 14, nodeY: 53, chipX: 25, chipY: 44, label: 'Filters', delay: 'd4' },
                { nodeX: 14, nodeY: 90, chipX: 25, chipY: 81, label: 'By type', delay: 'd5' },
              ]}
            />
          </div>
        </div>
      </div>
      <div className={s.body}>
        <h2 className={s.title}>{STEP2.title}</h2>
        <p className={s.copy}>{STEP2.body}</p>
      </div>
    </>
  );
}
