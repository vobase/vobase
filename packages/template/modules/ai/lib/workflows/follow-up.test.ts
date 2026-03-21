import { describe, expect, test } from 'bun:test';

import {
  analyzeConversationStep,
  followUpWorkflow,
  scheduleFollowUpStep,
  sendFollowUpStep,
} from './follow-up';

describe('follow-up workflow', () => {
  test('workflow is defined with correct id', () => {
    expect(followUpWorkflow.id).toBe('ai:follow-up');
  });

  test('analyzeConversationStep has correct id', () => {
    expect(analyzeConversationStep.id).toBe('analyze-conversation');
    expect(analyzeConversationStep.inputSchema).toBeDefined();
    expect(analyzeConversationStep.outputSchema).toBeDefined();
  });

  test('scheduleFollowUpStep has correct id', () => {
    expect(scheduleFollowUpStep.id).toBe('schedule-follow-up');
    expect(scheduleFollowUpStep.inputSchema).toBeDefined();
    expect(scheduleFollowUpStep.outputSchema).toBeDefined();
  });

  test('sendFollowUpStep has correct id', () => {
    expect(sendFollowUpStep.id).toBe('send-follow-up');
    expect(sendFollowUpStep.inputSchema).toBeDefined();
    expect(sendFollowUpStep.outputSchema).toBeDefined();
  });
});
