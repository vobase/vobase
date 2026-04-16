import {
  channelsTemplates,
  getCtx,
  notFound,
  unauthorized,
  validation,
} from '@vobase/core';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

// ─── Types ─────────────────────────────────────────────────────────

/** Template operations exposed by the WhatsApp adapter. */
interface WhatsAppAdapterWithTemplates {
  syncTemplates(): Promise<
    Array<{
      id: string;
      name: string;
      language: string;
      category: string;
      status: string;
      components: unknown[];
    }>
  >;
  createTemplate(input: {
    name: string;
    language: string;
    category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
    components: Array<{ type: string; [key: string]: unknown }>;
  }): Promise<{ id: string; status: string }>;
  deleteTemplate(name: string): Promise<void>;
}

function getWhatsAppAdapter(
  channels: ReturnType<typeof getCtx>['channels'],
): WhatsAppAdapterWithTemplates | null {
  const adapter = channels.getAdapter('whatsapp') as unknown as
    | WhatsAppAdapterWithTemplates
    | undefined;
  return adapter?.syncTemplates ? adapter : null;
}

// ─── Schemas ───────────────────────────────────────────────────────

const createTemplateSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(
      /^[a-z0-9_]+$/,
      'Name must be lowercase alphanumeric with underscores',
    ),
  language: z.string().default('en'),
  category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']),
  components: z.array(z.object({ type: z.string() }).passthrough()),
});

const updateTemplateSchema = z.object({
  category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']).optional(),
  components: z.array(z.object({ type: z.string() }).passthrough()).optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────

/** Auto-inject STOP quick reply for MARKETING templates. */
function injectStopButton(
  components: Array<{ type: string; [key: string]: unknown }>,
): void {
  const buttonsComponent = components.find((comp) => comp.type === 'BUTTONS');
  if (buttonsComponent) {
    const buttons =
      (buttonsComponent.buttons as Array<{
        type: string;
        text?: string;
      }>) ?? [];
    const hasStop = buttons.some(
      (b) => b.type === 'QUICK_REPLY' && b.text === 'STOP',
    );
    if (!hasStop) {
      buttons.push({ type: 'QUICK_REPLY', text: 'STOP' });
      buttonsComponent.buttons = buttons;
    }
  } else {
    components.push({
      type: 'BUTTONS',
      buttons: [{ type: 'QUICK_REPLY', text: 'STOP' }],
    });
  }
}

// ─── Handlers ──────────────────────────────────────────────────────

export const templatesHandlers = new Hono()
  /** GET /templates — List all templates. */
  .get('/templates', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const rows = await db
      .select()
      .from(channelsTemplates)
      .orderBy(desc(channelsTemplates.syncedAt));

    return c.json({ templates: rows });
  })

  /** GET /templates/:id — Single template. */
  .get('/templates/:id', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const id = c.req.param('id');
    const [row] = await db
      .select()
      .from(channelsTemplates)
      .where(eq(channelsTemplates.id, id));

    if (!row) throw notFound('Template not found');

    return c.json(row);
  })

  /** POST /templates/sync — Sync templates from Meta. */
  .post('/templates/sync', async (c) => {
    const { db, user, channels } = getCtx(c);
    if (!user) throw unauthorized();

    const adapter = getWhatsAppAdapter(channels);
    if (!adapter) {
      return c.json({
        synced: 0,
        message:
          'WhatsApp adapter not configured. Create templates locally and submit when connected.',
      });
    }

    const synced = await adapter.syncTemplates();

    const now = new Date();
    await Promise.all(
      synced.map((t) =>
        db
          .insert(channelsTemplates)
          .values({
            channel: 'whatsapp',
            externalId: t.id,
            name: t.name,
            language: t.language,
            category: t.category,
            status: t.status,
            components: JSON.stringify(t.components),
            syncedAt: now,
          })
          .onConflictDoUpdate({
            target: channelsTemplates.externalId,
            set: {
              name: t.name,
              language: t.language,
              category: t.category,
              status: t.status,
              components: JSON.stringify(t.components),
              syncedAt: now,
            },
          }),
      ),
    );

    return c.json({ synced: synced.length });
  })

  /** POST /templates — Create new template as DRAFT (local only). */
  .post('/templates', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const body = await c.req.json();
    const parsed = createTemplateSchema.safeParse(body);
    if (!parsed.success) throw validation(parsed.error.flatten().fieldErrors);

    const input = parsed.data;

    const [row] = await db
      .insert(channelsTemplates)
      .values({
        channel: 'whatsapp',
        externalId: null,
        name: input.name,
        language: input.language,
        category: input.category,
        status: 'DRAFT',
        components: JSON.stringify(input.components),
        syncedAt: new Date(),
      })
      .returning();

    return c.json({ template: row }, 201);
  })

  /** PUT /templates/:id — Update a DRAFT template. */
  .put('/templates/:id', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const id = c.req.param('id');

    const [existing] = await db
      .select()
      .from(channelsTemplates)
      .where(eq(channelsTemplates.id, id));

    if (!existing) throw notFound('Template not found');

    if (existing.status !== 'DRAFT') {
      throw validation({
        status: 'Only draft templates can be edited',
      });
    }

    const body = await c.req.json();
    const parsed = updateTemplateSchema.safeParse(body);
    if (!parsed.success) throw validation(parsed.error.flatten().fieldErrors);

    const data = parsed.data;

    const [row] = await db
      .update(channelsTemplates)
      .set({
        ...(data.category !== undefined && { category: data.category }),
        ...(data.components !== undefined && {
          components: JSON.stringify(data.components),
        }),
        syncedAt: new Date(),
      })
      .where(eq(channelsTemplates.id, id))
      .returning();

    return c.json(row);
  })

  /** POST /templates/:id/submit — Submit a DRAFT template to Meta for review. */
  .post('/templates/:id/submit', async (c) => {
    const { db, user, channels } = getCtx(c);
    if (!user) throw unauthorized();

    const id = c.req.param('id');

    const [existing] = await db
      .select()
      .from(channelsTemplates)
      .where(eq(channelsTemplates.id, id));

    if (!existing) throw notFound('Template not found');

    if (existing.status !== 'DRAFT' && existing.status !== 'REJECTED') {
      throw validation({
        status: 'Only draft or rejected templates can be submitted for review',
      });
    }

    const components = existing.components
      ? (JSON.parse(existing.components) as Array<{
          type: string;
          [key: string]: unknown;
        }>)
      : [];

    // Auto-inject STOP for marketing
    if (existing.category === 'MARKETING') {
      injectStopButton(components);
    }

    const adapter = getWhatsAppAdapter(channels);

    if (!adapter) {
      // No adapter — mark as APPROVED for local dev/testing
      const [row] = await db
        .update(channelsTemplates)
        .set({
          status: 'APPROVED',
          components: JSON.stringify(components),
          syncedAt: new Date(),
        })
        .where(eq(channelsTemplates.id, id))
        .returning();

      return c.json({
        template: row,
        message: 'No WhatsApp adapter — auto-approved for local testing.',
      });
    }

    const result = await adapter.createTemplate({
      name: existing.name,
      language: existing.language,
      category: existing.category as 'MARKETING' | 'UTILITY' | 'AUTHENTICATION',
      components: components as Array<{
        type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
        [key: string]: unknown;
      }>,
    });

    const [row] = await db
      .update(channelsTemplates)
      .set({
        externalId: result.id,
        status: result.status, // PENDING from Meta
        components: JSON.stringify(components),
        syncedAt: new Date(),
      })
      .where(eq(channelsTemplates.id, id))
      .returning();

    return c.json({ template: row });
  })

  /** DELETE /templates/:id — Delete template locally and from Meta if submitted. */
  .delete('/templates/:id', async (c) => {
    const { db, user, channels } = getCtx(c);
    if (!user) throw unauthorized();

    const id = c.req.param('id');

    const [existing] = await db
      .select()
      .from(channelsTemplates)
      .where(eq(channelsTemplates.id, id));

    if (!existing) throw notFound('Template not found');

    // If submitted to Meta, delete from there too
    if (existing.externalId) {
      const adapter = getWhatsAppAdapter(channels);
      if (adapter) {
        await adapter.deleteTemplate(existing.name).catch(() => {
          // Best-effort — don't block local deletion
        });
      }
    }

    await db.delete(channelsTemplates).where(eq(channelsTemplates.id, id));

    return c.json({ ok: true });
  });
