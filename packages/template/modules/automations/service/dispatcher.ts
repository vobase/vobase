// Sole writer of `automation_runs`. Body lands in Slice D (US-013).
export async function dispatchAutomationRun(_ruleId: string, _eventName: string, _payload: unknown): Promise<void> {
  throw new Error('dispatcher not implemented')
}
