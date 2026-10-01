/**
 * GeometricMark: the thin inline mark for empty states, speaking the same
 * vector grammar as docs/design/brand/cover.svg — a fragment of the hairline
 * column grid, one 2px structural ink rule, and the single red square.
 * Pure geometry (no text), currentColor ink, flat — no gradients/shadows.
 */
export function GeometricMark({ size = 40 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    >
      {/* hairline grid fragment */}
      <g stroke="var(--rule)" strokeWidth="1">
        <line x1="8" y1="4" x2="8" y2="36" />
        <line x1="16" y1="4" x2="16" y2="36" />
        <line x1="24" y1="4" x2="24" y2="36" />
        <line x1="32" y1="4" x2="32" y2="36" />
      </g>
      {/* structural rule across the grid */}
      <line x1="4" y1="28" x2="36" y2="28" stroke="var(--ink)" strokeWidth="2" />
      {/* the evidence square */}
      <rect x="24" y="12" width="8" height="8" fill="var(--accent)" />
    </svg>
  );
}
