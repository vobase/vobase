// good: uses CSS custom properties, no raw hex/oklch
export const Good = () => (
  <div style={{ color: 'var(--color-fg)', background: 'var(--color-bg)' }}>
    <span className="text-[var(--color-fg-muted)]">hello</span>
  </div>
)
