import { AnnotationLayer } from '../Annotation';
import { STEP3 } from '../content';
import s from '../onboarding.module.css';

export function Step3Toolbar() {
  return (
    <>
      <div className={s.hero}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={s.toolbarHeroImg}
          src="/onboarding/card3/toolbar.jpg"
          alt="A focused tile's toolbar: Code, VFX, Modulate, Sound, VCapture, Record, Save snapshot"
        />
        <AnnotationLayer
          items={[
            { nodeX: 34, nodeY: 15, chipX: 22, chipY: 86, label: 'Edit the source', delay: 'd0' },
            { nodeX: 157, nodeY: 15, chipX: 145, chipY: 86, label: 'Tune, route, add sound', delay: 'd1' },
            { nodeX: 367, nodeY: 15, chipX: 333, chipY: 86, label: 'Export a capture', delay: 'd2' },
            { nodeX: 585, nodeY: 15, chipX: 520, chipY: 86, label: 'Go fullscreen', delay: 'd3' },
          ]}
        />
      </div>
      <div className={s.body}>
        <h2 className={s.title}>{STEP3.title}</h2>
        <p className={s.copy}>{STEP3.bodyDesktop}</p>
      </div>
    </>
  );
}
