import { describe, expect, it } from 'bun:test';

import { HomePage } from '@/home';

describe('HomePage', () => {
  it('exports a component function', () => {
    expect(typeof HomePage).toBe('function');
  });
});
