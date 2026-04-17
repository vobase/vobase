import { channelsTemplates, type VobaseDb } from '@vobase/core';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { contactAttributeDefinitions } from '../schema';

interface PromptCtx {
  db: VobaseDb;
}

const FEW_SHOT_EXAMPLES = `# Examples

## Example 1 — recurring restaurant promo
User prompt: "Send a weekly Tuesday 11am lunch promo to lunch_crowd contacts with spend_tier of medium or higher"
Output:
{
  "name": "Weekly Tuesday lunch promo",
  "type": "recurring",
  "schedule": "0 11 * * 2",
  "timezone": "Asia/Singapore",
  "audienceFilter": {
    "roles": ["customer"],
    "attributes": [
      { "key": "segment", "value": "lunch_crowd" }
    ],
    "excludeOptedOut": true
  },
  "steps": [
    {
      "sequence": 1,
      "templateSuggestion": "lunch_promo_weekly",
      "variableMapping": { "1": "name" },
      "isFinal": true
    }
  ],
  "parameters": { "spendThreshold": "medium", "promoName": "Tuesday lunch" },
  "parameterSchema": {
    "spendThreshold": { "type": "select", "label": "Spend threshold", "options": [{ "value": "low", "label": "Low" }, { "value": "medium", "label": "Medium" }, { "value": "high", "label": "High" }] },
    "promoName": { "type": "string", "label": "Promo name" }
  }
}

## Example 2 — catering event reminder (date-relative)
User prompt: "Send event reminder 7 days before each customer's event_date at 9am"
Output:
{
  "name": "Event reminder — 7 days before",
  "type": "date-relative",
  "dateAttribute": "event_date",
  "timezone": "Asia/Singapore",
  "audienceFilter": { "roles": ["customer"], "excludeOptedOut": true },
  "steps": [
    {
      "sequence": 1,
      "offsetDays": -7,
      "sendAtTime": "09:00",
      "templateSuggestion": "event_reminder_7d",
      "variableMapping": { "1": "name", "2": "attributes.event_date" },
      "isFinal": true
    }
  ],
  "parameters": { "offsetDays": -7, "sendAtTime": "09:00" },
  "parameterSchema": {
    "offsetDays": { "type": "number", "label": "Days before event", "default": -7 },
    "sendAtTime": { "type": "time", "label": "Send time", "default": "09:00" }
  }
}

## Example 3 — clinic pre-treatment with chaser (date-relative + chaser)
User prompt: "Pre-treatment reminder 2 days before botox appointments at 9am, with 24-hour chaser if no reply"
Output:
{
  "name": "Botox pre-treatment reminder",
  "type": "date-relative",
  "dateAttribute": "appointment_date",
  "timezone": "Asia/Singapore",
  "audienceFilter": {
    "roles": ["customer"],
    "attributes": [{ "key": "treatment_category", "value": "botox" }],
    "excludeOptedOut": true
  },
  "steps": [
    {
      "sequence": 1,
      "offsetDays": -2,
      "sendAtTime": "09:00",
      "templateSuggestion": "pre_treatment_reminder_botox",
      "variableMapping": { "1": "name", "2": "attributes.appointment_date" },
      "isFinal": false
    },
    {
      "sequence": 2,
      "delayHours": 24,
      "templateSuggestion": "pre_treatment_chaser_botox",
      "variableMapping": { "1": "name" },
      "isFinal": true
    }
  ],
  "parameters": { "offsetDays": -2, "sendAtTime": "09:00", "chaserDelayHours": 24 },
  "parameterSchema": {
    "offsetDays": { "type": "number", "label": "Days before appointment", "default": -2 },
    "sendAtTime": { "type": "time", "label": "Send time", "default": "09:00" },
    "chaserDelayHours": { "type": "number", "label": "Chaser delay (hours)", "default": 24, "min": 1 }
  }
}

## Example 4 — audience operators (eq, !=, >=, contains)
User prompt: "Monthly VIP thank-you on the 1st at 10am to customers in Singapore who aren't on the free plan, aged 30+, whose city name contains 'singa'"
Output:
{
  "name": "Monthly VIP thank-you",
  "type": "recurring",
  "schedule": "0 10 1 * *",
  "timezone": "Asia/Singapore",
  "audienceFilter": {
    "roles": ["customer"],
    "attributes": [
      { "key": "country", "value": "Singapore" },
      { "key": "plan", "op": "!=", "value": "free" },
      { "key": "age", "op": ">=", "value": "30" },
      { "key": "city", "op": "contains", "value": "singa" }
    ],
    "excludeOptedOut": true
  },
  "steps": [
    {
      "sequence": 1,
      "templateSuggestion": "vip_monthly_thankyou",
      "variableMapping": { "1": "name" },
      "isFinal": true
    }
  ],
  "parameters": { "minAge": "30" },
  "parameterSchema": {
    "minAge": { "type": "string", "label": "Minimum age", "default": "30" }
  }
}`;

const SCHEMA_BLOCK = `# Output schema

You must return a JSON object matching this shape:
- name (string, required) — short human label
- description (string, optional)
- type (enum: "recurring" | "date-relative", required)
- schedule (cron string, required when type="recurring") — standard 5-field cron
- dateAttribute (string, required when type="date-relative") — must be one of the attribute keys listed below
- timezone (IANA zone, optional — default the org's timezone; use "Asia/Singapore" when unsure)
- audienceFilter (object, optional):
    - roles: array of "customer" | "lead" | "staff"
    - labelIds: array of label IDs (omit — you don't know these)
    - attributes: array of { key, value, op? } — key must be from the list below
        - op is one of "eq" | "!=" | ">=" | "<=" | "contains"; omit op to mean equality
        - value is always a string (JSONB is extracted as text; numeric comparisons lex-compare the stringified value)
    - excludeOptedOut: boolean (default true)
- suggestedSegments (array of strings, optional) — human-readable audience hints for the UI
- steps (array, at least one):
    - sequence (int, required, 1-indexed)
    - offsetDays (int, optional) — days offset from the date attribute (negative = before)
    - sendAtTime (string "HH:MM", optional) — send time in rule timezone
    - delayHours (int, optional) — delay from previous step; use for chasers
    - templateSuggestion (string, required) — the template NAME (not ID)
    - variableMapping (object: string -> string, optional) — WhatsApp placeholder index to context path (e.g., "1" -> "name", "2" -> "attributes.event_date")
    - isFinal (boolean, optional) — true on the last step in the chain
- parameters (object, optional) — the concrete parameter values the user can tune
- parameterSchema (object, optional) — describes each parameter's type for the UI editor:
    { key: { type: "number"|"string"|"boolean"|"select"|"template"|"time"|"audience-filter", label, default?, options?, min?, max? } }

Rules:
- templateSuggestion is the template NAME, not an ID. Pick from the approved list below; if nothing fits, invent a name and the UI will surface a missing-template warning.
- Only use attribute keys from the "Available contact attributes" list. If the user references an attribute that doesn't exist, still include the key — the UI will surface it as a missing definition.
- For recurring rules, produce a standard cron expression; do not invent non-cron formats.
- For date-relative rules, always set dateAttribute and give every step either offsetDays+sendAtTime or delayHours.
- Always populate parameterSchema entries for every key in parameters so the UI can render editors.`;

export async function buildSystemPrompt(
  ctx: PromptCtx,
  orgLanguage = 'en',
): Promise<string> {
  const languages = orgLanguage
    .split(',')
    .map((lang) => lang.trim())
    .filter((lang) => lang.length > 0);
  const effectiveLanguages = languages.length > 0 ? languages : ['en'];

  const [attrDefs, approvedTemplates] = await Promise.all([
    ctx.db
      .select({
        key: contactAttributeDefinitions.key,
        label: contactAttributeDefinitions.label,
        type: contactAttributeDefinitions.type,
      })
      .from(contactAttributeDefinitions)
      .orderBy(asc(contactAttributeDefinitions.sortOrder)),
    ctx.db
      .select({
        name: channelsTemplates.name,
        language: channelsTemplates.language,
        category: channelsTemplates.category,
      })
      .from(channelsTemplates)
      .where(
        and(
          eq(channelsTemplates.status, 'approved'),
          inArray(channelsTemplates.language, effectiveLanguages),
        ),
      ),
  ]);

  const attrSection =
    attrDefs.length > 0
      ? `# Available contact attributes\n${attrDefs
          .map((a) => `- \`${a.key}\` (${a.type}) — ${a.label}`)
          .join('\n')}`
      : '# Available contact attributes\n_(none defined yet — advise the user to create attribute definitions before using attribute filters)_';

  const tmplByLanguage = new Map<
    string,
    Array<(typeof approvedTemplates)[number]>
  >();
  for (const t of approvedTemplates) {
    const bucket = tmplByLanguage.get(t.language) ?? [];
    bucket.push(t);
    tmplByLanguage.set(t.language, bucket);
  }

  let tmplSection: string;
  if (approvedTemplates.length === 0) {
    tmplSection = `# Approved message templates\n_(none approved yet for language(s): ${effectiveLanguages.join(', ')})_`;
  } else if (effectiveLanguages.length === 1) {
    const lang = effectiveLanguages[0];
    tmplSection = `# Approved message templates (language: ${lang})\n${approvedTemplates
      .map((t) => `- \`${t.name}\`${t.category ? ` — ${t.category}` : ''}`)
      .join('\n')}`;
  } else {
    const sections: string[] = [];
    for (const lang of effectiveLanguages) {
      const rows = tmplByLanguage.get(lang) ?? [];
      sections.push(
        `## Language: ${lang}\n${
          rows.length === 0
            ? '_(none approved)_'
            : rows
                .map(
                  (t) =>
                    `- \`${t.name}\`${t.category ? ` — ${t.category}` : ''}`,
                )
                .join('\n')
        }`,
      );
    }
    tmplSection = `# Approved message templates\n${sections.join('\n\n')}`;
  }

  return [
    'You design messaging automation rules from natural-language descriptions. Return strictly valid JSON matching the schema below. Do not invent capabilities outside the schema.',
    SCHEMA_BLOCK,
    attrSection,
    tmplSection,
    FEW_SHOT_EXAMPLES,
  ].join('\n\n');
}
