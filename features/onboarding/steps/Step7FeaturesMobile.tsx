import { STEP7 } from '../content';
import s from '../onboarding.module.css';

export function Step7FeaturesMobile() {
  return (
    <>
      <div className={s.wordmarkBlock} style={{ padding: '10px 0 16px 0' }}>
        <div className={s.mWordmark}>
          <span className={s.wordmarkM}>Visual Mood</span> <span className={s.wordmarkL}>Lab</span>
        </div>
        <div className={s.mTagline}>{STEP7.tagline}</div>
      </div>

      <hr className={s.sectionDivider} style={{ marginBottom: 14 }} />

      <div className={s.mFeatLabel}>{STEP7.sectionLabel}</div>
      {STEP7.features.map((f) => (
        <div key={f.name} className={s.mFeatItem}>
          <span className={s.featDot} aria-hidden="true" />
          <div className={s.mFeatText}>
            <b>{f.name}</b>
            {f.isNew && <span className={s.newTag}>New</span>} <span>&mdash; {f.descMobile}</span>
          </div>
        </div>
      ))}
    </>
  );
}
