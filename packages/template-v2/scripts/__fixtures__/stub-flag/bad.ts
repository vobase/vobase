// bad: stub flag still present — caught by check-no-stub-flag
const isStub = import.meta.env.VITE_INBOX_STUB_ENDPOINTS === 'true'
export { isStub }
