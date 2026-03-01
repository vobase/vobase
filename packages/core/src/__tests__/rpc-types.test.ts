import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { hc } from 'hono/client';

/**
 * Hono RPC Type Inference Validation (T17)
 *
 * FINDINGS:
 * - Chained .route(): WORKS - runtime mounting works, and `typeof chainedApp` preserves route literals for RPC typing.
 * - Dynamic reduce: DOESN'T WORK (for RPC typing) - runtime mounting works, but `new Hono() as Hono` widens the schema and drops typed client paths.
 * - hc<AppType> inference: WORKS with chained route exports - typed client methods (`$get`, `$post`, `$url`) are inferred from mounted paths.
 * - TypeScript compilation: passes with 2 chained routes when the dynamic reduce limitation is captured via `@ts-expect-error`.
 *
 * RECOMMENDATION for vobase:
 * - Export an RPC-facing app type from chained `.route()` composition and avoid reduce-based widened `Hono` values for frontend RPC typing.
 */

type Invoice = { id: string; total: number };

const invoicingRouter = new Hono()
  .get('/list', (c) => c.json({ invoices: [] as Invoice[] }))
  .post('/create', (c) => c.json({ id: 'inv-001', total: 0 } as Invoice));

const ordersRouter = new Hono().get('/list', (c) =>
  c.json({ orders: [] as Array<{ id: string }> }),
);

const chainedApp = new Hono()
  .route('/api/invoicing', invoicingRouter)
  .route('/api/orders', ordersRouter);
export type ChainedAppType = typeof chainedApp;

const chainedClient = hc<ChainedAppType>('http://localhost:3000');

const modules = [
  { name: 'invoicing', routes: invoicingRouter },
  { name: 'orders', routes: ordersRouter },
];

const dynamicApp = modules.reduce(
  (acc, mod) => acc.route(`/api/${mod.name}`, mod.routes),
  new Hono() as Hono,
);

type DynamicAppType = typeof dynamicApp;
const dynamicClient = hc<DynamicAppType>('http://localhost:3000');

// biome-ignore lint/complexity/noBannedTypes: intentional Function check for type-level test
type IsFunction<T> = T extends Function ? true : false;
type Expect<T extends true> = T;

const chainedListGet = chainedClient.api.invoicing.list.$get;
const chainedCreatePost = chainedClient.api.invoicing.create.$post;
type _ChainedListGetCallable = Expect<IsFunction<typeof chainedListGet>>;
type _ChainedCreatePostCallable = Expect<IsFunction<typeof chainedCreatePost>>;

// @ts-expect-error Dynamic reduce app type loses literal route inference for RPC client access.
dynamicClient.api.invoicing.list.$get;

describe('Hono RPC type inference', () => {
  it('mounts routes correctly via chained .route()', async () => {
    const res = await chainedApp.request('http://localhost/api/invoicing/list');

    expect(res.status).toBe(200);
    const data = (await res.json()) as { invoices: Invoice[] };
    expect(data).toHaveProperty('invoices');
  });

  it('exposes typed hc<AppType> methods for chained routes', () => {
    const listUrl = chainedClient.api.invoicing.list.$url();
    const createUrl = chainedClient.api.invoicing.create.$url();

    expect(listUrl.pathname).toBe('/api/invoicing/list');
    expect(createUrl.pathname).toBe('/api/invoicing/create');
  });

  it('mounts routes correctly via reduce() pattern used by createApp', async () => {
    const invoicingRes = await dynamicApp.request(
      'http://localhost/api/invoicing/list',
    );
    expect(invoicingRes.status).toBe(200);

    const ordersRes = await dynamicApp.request(
      'http://localhost/api/orders/list',
    );
    expect(ordersRes.status).toBe(200);
    const ordersData = (await ordersRes.json()) as {
      orders: Array<{ id: string }>;
    };
    expect(ordersData).toHaveProperty('orders');
  });
});
