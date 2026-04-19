// bad: tabs auto-derived from navItems — caught by check-no-auto-nav-tabs
const navItems = [{ label: 'Inbox', path: '/' }, { label: 'Approvals', path: '/approvals' }]
export const BadTabs = () => (
  <div>
    {navItems.map(item => <button key={item.path}>{item.label}</button>)}
  </div>
)
