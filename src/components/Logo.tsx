/** The TRACE three-diamond mark: accent diamond on top, two in the current text colour. */
export function Mark({ size = 26, accent = "var(--accent)" }: { size?: number; accent?: string }) {
  const h = (size * 276) / 382;
  const d = (cx: number, cy: number) => `M${cx} ${cy - 85} L${cx + 85} ${cy} L${cx} ${cy + 85} L${cx - 85} ${cy} Z`;
  return (
    <svg width={size} height={h} viewBox="0 0 382 276" aria-hidden="true">
      <path d={d(191, 85)} fill={accent} />
      <path d={d(85, 191)} fill="currentColor" />
      <path d={d(297, 191)} fill="currentColor" />
    </svg>
  );
}

/** "TRACE.SIGN" → TRACE<b>.</b>SIGN (works for any white-label "NAME.SIGN"). */
export function Wordmark({ name = "TRACE.SIGN" }: { name?: string }) {
  const i = name.lastIndexOf(".");
  return (
    <span className="brand-word">
      {i > 0 && i < name.length - 1 ? (
        <>
          {name.slice(0, i)}
          <b>.</b>
          {name.slice(i + 1)}
        </>
      ) : (
        name
      )}
    </span>
  );
}
