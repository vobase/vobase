import { describe, expect, test } from 'bun:test';

import {
  analyzeStep,
  approvalStep,
  escalationWorkflow,
  executeStep,
} from './escalation';

describe('escalation workflow', () => {
  test('workflow is defined with correct id', () => {
    expect(escalationWorkflow.id).toBe('ai:escalation');
  });

  test('analyzeStep has correct id and schemas', () => {
    expect(analyzeStep.id).toBe('analyze-escalation');
    expect(analyzeStep.inputSchema).toBeDefined();
    expect(analyzeStep.outputSchema).toBeDefined();
  });

  test('approvalStep has correct id and suspend/resume schemas', () => {
    expect(approvalStep.id).toBe('human-approval');
    expect(approvalStep.inputSchema).toBeDefined();
    expect(approvalStep.outputSchema).toBeDefined();
  });

  test('executeStep has correct id', () => {
    expect(executeStep.id).toBe('execute-escalation');
    expect(executeStep.inputSchema).toBeDefined();
    expect(executeStep.outputSchema).toBeDefined();
  });
});
