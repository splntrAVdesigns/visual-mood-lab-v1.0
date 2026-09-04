import s from './onboarding.module.css';

export interface AnnotationSpec {
  /** Node (the small pulsing dot) position, in px, relative to the
      nearest positioned ancestor (.hero or .panelFrame). */
  nodeX: number;
  nodeY: number;
  /** Chip (the label) position, in px. Independent of node position —
      see file doc comment. */
  chipX: number;
  chipY: number;
  label: string;
  /** Stagger slot — d0 through d5, matching onboarding.module.css. */
  delay: 'd0' | 'd1' | 'd2' | 'd3' | 'd4' | 'd5';
}

/**
 * Renders one node+glow+chip annotation. Positioning is intentionally
 * verbatim px (not a percentage or a `pointsAt` ref) — every annotation
 * in this guide was hand-placed against a specific static screenshot, so
 * there is nothing to compute at runtime; getting it wrong here just
 * means editing the spec's numbers, not the component.
 */
export function Annotation({ nodeX, nodeY, chipX, chipY, label, delay }: AnnotationSpec) {
  return (
    <>
      <span
        className={`${s.node} ${s[delay]}`}
        style={{ left: nodeX, top: nodeY }}
        aria-hidden="true"
      />
      <span
        className={`${s.glow} ${s[delay]}`}
        style={{ left: nodeX, top: nodeY }}
        aria-hidden="true"
      />
      <span
        className={`${s.chip} ${s[delay]}`}
        style={{ left: chipX, top: chipY }}
        aria-hidden="true"
      >
        {label}
      </span>
    </>
  );
}

export function AnnotationLayer({ items }: { items: AnnotationSpec[] }) {
  return (
    <>
      {items.map((item, i) => (
        <Annotation key={i} {...item} />
      ))}
    </>
  );
}
