import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';

import { VobaseError } from './errors';
import { defineBuiltinModule, defineModule } from './module';
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

  it('allows empty schema for modules without tables', () => {
    const module = defineModule({
      ...createBaseConfig('billing'),
      schema: {},
    });
    expect(module.name).toBe('billing');
  });
});

describe('defineBuiltinModule()', () => {
  it("succeeds for name='_audit'", () => {
    const module = defineBuiltinModule({
      name: '_audit',
      schema: { auditLog: {} },
      routes: new Hono(),
    });
    expect(module.name).toBe('_audit');
    expect(Object.isFrozen(module)).toBe(true);
  });

  it("succeeds for name='_sequences'", () => {
    const module = defineBuiltinModule({
      name: '_sequences',
      schema: { sequences: {} },
      routes: new Hono(),
    });
    expect(module.name).toBe('_sequences');
  });

  it('accepts an init hook', () => {
    const module = defineBuiltinModule({
      name: '_credentials',
      schema: { credentials: {} },
      routes: new Hono(),
      init: () => {},
    });
    expect(module.init).toBeDefined();
  });

  it('allows empty schema for built-in modules', () => {
    const module = defineBuiltinModule({
      name: '_system-proxy',
      schema: {},
      routes: new Hono(),
    });
    expect(module.name).toBe('_system-proxy');
  });

  it("throws for name without _ prefix (e.g., 'audit')", () => {
    expectValidationError(() => {
      defineBuiltinModule({
        name: 'audit',
        schema: { auditLog: {} },
        routes: new Hono(),
      });
    });
  });

  it("throws for name with uppercase (e.g., '_Audit')", () => {
    expectValidationError(() => {
      defineBuiltinModule({
        name: '_Audit',
        schema: { auditLog: {} },
        routes: new Hono(),
      });
    });
  });
});

describe('defineModule rejects _ prefix', () => {
  it("throws for name='_audit' via defineModule", () => {
    expectValidationError(() => {
      defineModule(createBaseConfig('_audit'));
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
