import { AnnotationLayer } from '../Annotation';
import { STEP5 } from '../content';
import s from '../onboarding.module.css';

export function Step5Modulation() {
  return (
    <>
      <div className={s.hero}>
        <div className={s.videoBadgeLabel}>
          <span className={s.liveDot} aria-hidden="true" />
          Live
        </div>
        <div className={s.videoBadge}>
          <video
            autoPlay
            muted
            loop
            playsInline
            poster="/onboarding/card5/live-loop-poster.jpg"
          >
            <source src="/onboarding/card5/live-loop.mp4" type="video/mp4" />
          </video>
        </div>

        <div className={s.panelFrame} style={{ width: 300, height: 402 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className={s.panelImg}
            style={{ width: 298, height: 400 }}
            src="/onboarding/card5/panel.jpg"
            alt="Modulation panel: Direction source (LFO — Sine), Amount, Rate, Smoothing, and Assign"
          />
          <AnnotationLayer
            items={[
              { nodeX: 15, nodeY: 126, chipX: 25, chipY: 118, label: 'Choose what drives it', delay: 'd0' },
              { nodeX: 15, nodeY: 350, chipX: 25, chipY: 342, label: 'Click Assign to route it', delay: 'd1' },
            ]}
          />
        </div>
      </div>
      <div className={s.body}>
        <h2 className={s.title}>{STEP5.title}</h2>
        <p className={s.copy}>{STEP5.bodyDesktop}</p>
      </div>
    </>
  );
}
