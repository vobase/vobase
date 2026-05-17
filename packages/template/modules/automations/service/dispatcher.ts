// US-013 will populate dispatcher logic. For US-002 this file exists to satisfy
// check:shape's AUTOMATION_RUNS_WRITE_ALLOWED allowlist and act as the home
// for the eventual `automation.dispatch` pg-boss handler.
export async function dispatchAutomationRun(_ruleId: string, _eventName: string, _payload: unknown): Promise<void> {
  throw new Error('dispatcher not implemented (US-013)')
}
