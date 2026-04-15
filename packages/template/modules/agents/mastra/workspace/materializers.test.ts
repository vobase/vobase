import { describe, expect, test } from 'bun:test';

import { formatBookings, formatProfile, formatState } from './materializers';

describe('formatState', () => {
  test('renders all fields for active conversation', () => {
    const result = formatState({
      status: 'active',
      assignee: 'agent-1',
      onHold: false,
      holdReason: null,
      priority: 'high',
      outcome: null,
      autonomyLevel: 'full_ai',
      createdAt: new Date('2025-01-15T10:00:00Z'),
      resolvedAt: null,
      channelType: 'whatsapp',
      channelLabel: 'Main WhatsApp',
    });

    expect(result).toContain('# State');
    expect(result).toContain('status: active');
    expect(result).toContain('assignee: agent-1');
    expect(result).toContain('channel: whatsapp (Main WhatsApp)');
    expect(result).toContain('on_hold: false');
    expect(result).toContain('priority: high');
    expect(result).toContain('autonomy: full_ai');
    expect(result).toContain('created: 2025-01-15T10:00:00.000Z');
    expect(result).not.toContain('hold_reason');
    expect(result).not.toContain('resolved:');
    expect(result).not.toContain('outcome:');
  });

  test('includes hold reason when on hold', () => {
    const result = formatState({
      status: 'active',
      assignee: 'agent-1',
      onHold: true,
      holdReason: 'Waiting for customer reply',
      priority: null,
      outcome: null,
      autonomyLevel: null,
      createdAt: new Date('2025-01-15T10:00:00Z'),
      resolvedAt: null,
      channelType: 'web',
      channelLabel: 'Web Chat',
    });

    expect(result).toContain('on_hold: true');
    expect(result).toContain('hold_reason: Waiting for customer reply');
  });

  test('includes resolved date for resolved conversations', () => {
    const result = formatState({
      status: 'resolved',
      assignee: 'agent-1',
      onHold: false,
      holdReason: null,
      priority: null,
      outcome: 'resolved',
      autonomyLevel: null,
      createdAt: new Date('2025-01-15T10:00:00Z'),
      resolvedAt: new Date('2025-01-16T14:30:00Z'),
      channelType: 'email',
      channelLabel: 'Support Email',
    });

    expect(result).toContain('outcome: resolved');
    expect(result).toContain('resolved: 2025-01-16T14:30:00.000Z');
  });
});

describe('formatProfile', () => {
  test('renders full profile', () => {
    const result = formatProfile({
      name: 'Alice Tan',
      phone: '+6591234567',
      email: 'alice@example.com',
      role: 'customer',
      identifier: 'alice-tan',
      createdAt: new Date('2025-01-10T08:00:00Z'),
    });

    expect(result).toContain('# Profile');
    expect(result).toContain('name: Alice Tan');
    expect(result).toContain('phone: +6591234567');
    expect(result).toContain('email: alice@example.com');
    expect(result).toContain('role: customer');
    expect(result).toContain('identifier: alice-tan');
    expect(result).toContain('since: 2025-01-10T08:00:00.000Z');
  });

  test('omits null fields', () => {
    const result = formatProfile({
      name: null,
      phone: '+6591234567',
      email: null,
      role: 'lead',
      identifier: null,
      createdAt: new Date('2025-01-10T08:00:00Z'),
    });

    expect(result).not.toContain('name:');
    expect(result).not.toContain('email:');
    expect(result).not.toContain('identifier:');
    expect(result).toContain('phone: +6591234567');
    expect(result).toContain('role: lead');
  });
});

describe('formatBookings', () => {
  test('returns empty message for no bookings', () => {
    const result = formatBookings([]);
    expect(result).toContain('# Bookings');
    expect(result).toContain('No bookings found.');
  });

  test('renders booking list', () => {
    const result = formatBookings([
      { title: 'Consultation', date: '2025-02-01 14:00', status: 'confirmed' },
      { title: 'Follow-up', date: '2025-02-05 10:00', status: 'pending' },
    ]);

    expect(result).toContain('# Bookings');
    expect(result).toContain('- 2025-02-01 14:00 | Consultation (confirmed)');
    expect(result).toContain('- 2025-02-05 10:00 | Follow-up (pending)');
  });
});
