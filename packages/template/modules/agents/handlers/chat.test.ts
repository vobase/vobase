import { describe, expect, it } from 'bun:test';

import { visitorDayInfo } from './chat';

const TZ = 'Asia/Singapore';

describe('visitorDayInfo', () => {
  it('returns correct letter for each day of the week', () => {
    // Mon 2026-03-30 → A
    expect(
      visitorDayInfo(new Date('2026-03-30T10:00:00+08:00'), TZ).letter,
    ).toBe('A');
    // Tue 2026-03-31 → B
    expect(
      visitorDayInfo(new Date('2026-03-31T10:00:00+08:00'), TZ).letter,
    ).toBe('B');
    // Wed 2026-04-01 → C
    expect(
      visitorDayInfo(new Date('2026-04-01T10:00:00+08:00'), TZ).letter,
    ).toBe('C');
    // Thu 2026-04-02 → D
    expect(
      visitorDayInfo(new Date('2026-04-02T10:00:00+08:00'), TZ).letter,
    ).toBe('D');
    // Fri 2026-04-03 → E
    expect(
      visitorDayInfo(new Date('2026-04-03T10:00:00+08:00'), TZ).letter,
    ).toBe('E');
    // Sat 2026-04-04 → F
    expect(
      visitorDayInfo(new Date('2026-04-04T10:00:00+08:00'), TZ).letter,
    ).toBe('F');
    // Sun 2026-04-05 → G
    expect(
      visitorDayInfo(new Date('2026-04-05T10:00:00+08:00'), TZ).letter,
    ).toBe('G');
  });

  it('returns YYYYMMDD date key', () => {
    const { dateKey } = visitorDayInfo(
      new Date('2026-03-31T10:00:00+08:00'),
      TZ,
    );
    expect(dateKey).toBe('20260331');
  });

  it('uses timezone-aware date, not UTC', () => {
    // 2026-04-01 00:30 SGT = 2026-03-31 16:30 UTC
    // In Singapore it's already Wednesday April 1, but UTC is still Tuesday March 31
    const lateNight = new Date('2026-04-01T00:30:00+08:00');
    const { dateKey, letter } = visitorDayInfo(lateNight, TZ);
    expect(dateKey).toBe('20260401');
    expect(letter).toBe('C');
  });

  it('handles midnight boundary correctly', () => {
    // Just before midnight SGT → still Tuesday
    const beforeMidnight = new Date('2026-03-31T23:59:59+08:00');
    expect(visitorDayInfo(beforeMidnight, TZ).letter).toBe('B');
    expect(visitorDayInfo(beforeMidnight, TZ).dateKey).toBe('20260331');

    // Just after midnight SGT → Wednesday
    const afterMidnight = new Date('2026-04-01T00:00:01+08:00');
    expect(visitorDayInfo(afterMidnight, TZ).letter).toBe('C');
    expect(visitorDayInfo(afterMidnight, TZ).dateKey).toBe('20260401');
  });
});
