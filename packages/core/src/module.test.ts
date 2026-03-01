import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';

import { VobaseError } from './errors';
import { defineModule } from './module';
import { registerModules } from './module-registry';

function createBaseConfig(name: string) {
  return {
    name,
    schema: { invoices: {} },
    routes: new Hono(),
  };
}

function expectValidationError(fn: () => void): void {
  try {
    fn();
    throw new Error('Expected defineModule to throw a VobaseError');
  } catch (error) {
    expect(error).toBeInstanceOf(VobaseError);
    expect((error as VobaseError).code).toBe('VALIDATION');
  }
}

describe('defineModule()', () => {
  it("returns a frozen VobaseModule for name='invoicing'", () => {
    const module = defineModule(createBaseConfig('invoicing'));

    expect(module.name).toBe('invoicing');
    expect(module.schema).toEqual({ invoices: {} });
    expect(Object.isFrozen(module)).toBe(true);
  });

  it("throws VobaseError for name='auth'", () => {
    expectValidationError(() => {
      defineModule(createBaseConfig('auth'));
    });
  });

  it("throws VobaseError for name='mcp'", () => {
    expectValidationError(() => {
      defineModule(createBaseConfig('mcp'));
    });
  });

  it("throws VobaseError for name='health'", () => {
    expectValidationError(() => {
      defineModule(createBaseConfig('health'));
    });
  });

  it("throws VobaseError for name='api'", () => {
    expectValidationError(() => {
      defineModule(createBaseConfig('api'));
    });
  });

  it("allows name='system'", () => {
    const module = defineModule(createBaseConfig('system'));
    expect(module.name).toBe('system');
  });

  it("throws for name='AUTH'", () => {
    expectValidationError(() => {
      defineModule(createBaseConfig('AUTH'));
    });
  });

  it("allows name='invoice-2024'", () => {
    const module = defineModule(createBaseConfig('invoice-2024'));
    expect(module.name).toBe('invoice-2024');
  });

  it('throws for empty schema', () => {
    expectValidationError(() => {
      defineModule({
        ...createBaseConfig('billing'),
        schema: {},
      });
    });
  });
});

describe('registerModules()', () => {
  it('throws when duplicate module names are provided', () => {
    const first = defineModule(createBaseConfig('orders'));
    const second = defineModule({
      ...createBaseConfig('orders'),
      schema: { payments: {} },
    });

    try {
      registerModules([first, second]);
      throw new Error('Expected registerModules to throw for duplicate names');
    } catch (error) {
      expect(error).toBeInstanceOf(VobaseError);
      expect((error as VobaseError).code).toBe('CONFLICT');
    }
  });
});
