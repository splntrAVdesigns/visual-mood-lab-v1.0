import { AnnotationLayer } from '../Annotation';
import { STEP3 } from '../content';
import s from '../onboarding.module.css';

export function Step3ToolbarMobile() {
  return (
    <>
      <div className={s.hero} style={{ height: 100, margin: '0 -18px', width: 'calc(100% + 36px)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/onboarding/card3/toolbar-mobile.jpg"
          alt="Mobile toolbar: Edit source, Capture, Save look, Reset"
          style={{
            position: 'absolute',
            top: 30,
            left: 0,
            width: '100%',
            height: 38,
            objectFit: 'cover',
            display: 'block',
          }}
        />
        <AnnotationLayer
          items={[
            { nodeX: 39, nodeY: 14, chipX: 1, chipY: 74, label: 'Edit source', delay: 'd0' },
            { nodeX: 123, nodeY: 14, chipX: 96, chipY: 74, label: 'Capture', delay: 'd1' },
            { nodeX: 242, nodeY: 14, chipX: 210, chipY: 74, label: 'Save look', delay: 'd2' },
            { nodeX: 341, nodeY: 14, chipX: 320, chipY: 74, label: 'Reset', delay: 'd3' },
          ]}
        />
      </div>
      <div className={s.body} style={{ paddingTop: 12 }}>
        <h2 className={s.title} style={{ fontSize: 18 }}>
          {STEP3.title}
        </h2>
        <p className={s.copy} style={{ fontSize: 13.5 }}>
          {STEP3.bodyMobile}
        </p>
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/onboarding/card3/example-tile.jpg"
            alt="Example of an open tile, showing its live canvas"
            style={{
              width: 200,
              height: 200,
              objectFit: 'cover',
              borderRadius: 3,
              border: '1px solid var(--border-hi)',
              display: 'inline-block',
            }}
          />
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-mute)',
              marginTop: 8,
            }}
          >
            Example — an open tile
          </div>
        </div>
      </div>
    </>
  );
}
