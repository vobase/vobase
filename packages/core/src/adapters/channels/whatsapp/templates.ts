import type { GraphApiResponse } from './api';
import {
  TEMPLATE_MAX_BUTTONS,
  TEMPLATE_MAX_CHARS,
  TEMPLATE_NAME_RE,
  type CreateTemplateInput,
  type WhatsAppTemplate,
} from './types';

// ─── Template Operations Factory ─────────────────────────────────────

export interface TemplateOperations {
  syncTemplates(): Promise<WhatsAppTemplate[]>;
  createTemplate(template: CreateTemplateInput): Promise<{ id: string; status: string }>;
  deleteTemplate(name: string): Promise<void>;
  getTemplate(name: string): Promise<WhatsAppTemplate | null>;
}

export function createTemplateOperations(
  graphFetch: (path: string, options?: RequestInit) => Promise<GraphApiResponse>,
  phoneNumberId: string,
): TemplateOperations {
  let cachedWabaId: string | null = null;

  async function getWabaId(): Promise<string> {
    if (cachedWabaId) return cachedWabaId;
    const phoneData = await graphFetch(`/${phoneNumberId}?fields=owner`);
    const wabaId = phoneData.owner;
    if (!wabaId) throw new Error('Could not determine WABA ID from phone number');
    cachedWabaId = wabaId as string;
    return cachedWabaId;
  }

  async function syncTemplates(): Promise<WhatsAppTemplate[]> {
    const wabaId = await getWabaId();
    const data = await graphFetch(`/${wabaId}/message_templates?limit=100`);

    return (data.data ?? []).map((t) => {
      const tmpl = t as WhatsAppTemplate;
      return {
        id: tmpl.id,
        name: tmpl.name,
        language: tmpl.language,
        category: tmpl.category,
        status: tmpl.status,
        components: tmpl.components,
      };
    });
  }

  async function createTemplate(
    template: CreateTemplateInput,
  ): Promise<{ id: string; status: string }> {
    if (!TEMPLATE_NAME_RE.test(template.name)) {
      throw new Error(
        `Invalid template name "${template.name}": must match ^[a-z0-9_]+$`,
      );
    }
    const bodyComponent = template.components.find((c) => c.type === 'BODY');
    if (!bodyComponent) {
      throw new Error('Template must have at least one BODY component');
    }
    const bodyText = (bodyComponent.text as string | undefined) ?? '';
    if (bodyText.length > TEMPLATE_MAX_CHARS) {
      throw new Error(
        `Template body text (${bodyText.length} chars) exceeds maximum of ${TEMPLATE_MAX_CHARS}`,
      );
    }
    const buttonsComponent = template.components.find((c) => c.type === 'BUTTONS');
    if (buttonsComponent) {
      const buttons = buttonsComponent.buttons;
      if (Array.isArray(buttons) && buttons.length > TEMPLATE_MAX_BUTTONS) {
        throw new Error(
          `Template has ${buttons.length} buttons; maximum is ${TEMPLATE_MAX_BUTTONS}`,
        );
      }
    }

    const wabaId = await getWabaId();
    const data = await graphFetch(`/${wabaId}/message_templates`, {
      method: 'POST',
      body: JSON.stringify({
        name: template.name,
        language: template.language,
        category: template.category,
        components: template.components,
      }),
    });
    return { id: data.id as string, status: data.status as string };
  }

  async function deleteTemplate(name: string): Promise<void> {
    const wabaId = await getWabaId();
    await graphFetch(
      `/${wabaId}/message_templates?name=${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    );
  }

  async function getTemplate(name: string): Promise<WhatsAppTemplate | null> {
    const wabaId = await getWabaId();
    try {
      const data = await graphFetch(
        `/${wabaId}/message_templates?name=${encodeURIComponent(name)}&fields=id,name,language,category,status,components`,
      );
      const templates = data.data as WhatsAppTemplate[] | undefined;
      return templates?.[0] ?? null;
    } catch {
      return null;
    }
  }

  return { syncTemplates, createTemplate, deleteTemplate, getTemplate };
}
