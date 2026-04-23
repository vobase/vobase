// bad: tabs auto-derived from navItems — caught by check-no-auto-nav-tabs
const navItems = [
  { label: 'Messaging', path: '/' },
  { label: 'Approvals', path: '/approvals' },
]
export const BadTabs = () => (
  <div>
    {navItems.map((item) => (
      <button type="button" key={item.path}>
        {item.label}
      </button>
    ))}
  </div>
)
