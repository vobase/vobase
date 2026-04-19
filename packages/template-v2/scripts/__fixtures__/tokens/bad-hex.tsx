// bad: hardcoded hex color — should be caught by check-tokens
export const Bad = () => (
  <div style={{ color: '#0b0b0b' }}>
    <span className="bg-[#1a1a1a]">hello</span>
  </div>
)
