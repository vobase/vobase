/**
 * CSV parsing and contact resolution for broadcast recipients.
 *
 * Parses a CSV file, normalises phone numbers, resolves or creates contacts,
 * and inserts broadcastRecipients rows ready for dispatch.
 */
import type { VobaseDb } from '@vobase/core';
import { eq, sql } from 'drizzle-orm';

import {
  broadcastRecipients,
  broadcasts,
  contactLabels,
  contacts,
  labels,
} from '../schema';

// ─── CSV Parser ───────────────────────────────────────────────────────

/**
 * Parse CSV text into headers and rows.
 * Handles quoted fields containing commas and newlines.
 * Returns the header row separately; all data rows follow.
 */
export function parseCSV(text: string): {
  headers: string[];
  rows: string[][];
} {
  const lines = splitCSVLines(text);
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = parseCSVRow(lines[0]).map((h) => h.trim());
  const rows: string[][] = [];

  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVRow(lines[i]).map((cell) => cell.trim());
    // Skip blank rows (all cells empty)
    if (row.every((cell) => cell === '')) continue;
    rows.push(row);
  }

  return { headers, rows };
}

/**
 * Split CSV text into logical lines, respecting quoted fields that may
 * span multiple lines.
 */
function splitCSVLines(text: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        // Escaped quote inside quoted field
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
        current += ch;
      }
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      // Skip \r in \r\n
      if (ch === '\r' && next === '\n') i++;
      if (current.trim() !== '') lines.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim() !== '') lines.push(current);
  return lines;
}

/**
 * Parse a single CSV row into an array of field values.
 * Strips surrounding quotes and unescapes doubled quotes.
 */
function parseCSVRow(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(field);
      field = '';
    } else {
      field += ch;
    }
  }

  fields.push(field);
  return fields;
}

// ─── Phone Normalisation ──────────────────────────────────────────────

/**
 * Normalise a Singapore phone number to E.164 format (+65XXXXXXXX).
 *
 * Accepted input formats:
 *   - "91234567"        → "+6591234567"   (8-digit, starts with 8 or 9)
 *   - "9123 4567"       → "+6591234567"   (with spaces)
 *   - "+65-91234567"    → "+6591234567"   (with country code + dashes)
 *   - "6591234567"      → "+6591234567"   (10-digit, starts with 65)
 *   - "+1234567890"     → "+1234567890"   (international — kept as-is)
 *
 * Returns null if the number is invalid after normalisation.
 */
export function normalizeSGPhone(phone: string): string | null {
  // Strip spaces, dashes, parentheses
  const stripped = phone.replace(/[\s\-()]/g, '');

  // International — keep as-is (starts with +, at least 7 digits)
  if (stripped.startsWith('+')) {
    return /^\+\d{7,15}$/.test(stripped) ? stripped : null;
  }

  // 10-digit starting with "65" → +65XXXXXXXX
  if (/^65\d{8}$/.test(stripped)) {
    return `+${stripped}`;
  }

  // 8-digit starting with 8 or 9 → +65XXXXXXXX
  if (/^[89]\d{7}$/.test(stripped)) {
    return `+65${stripped}`;
  }

  return null;
}

// ─── Phone Column Detection ───────────────────────────────────────────

const PHONE_HEADER_PATTERNS = ['phone', 'phone_number', 'mobile', 'whatsapp'];

function findPhoneColumnIndex(headers: string[]): number {
  return headers.findIndex((h) =>
    PHONE_HEADER_PATTERNS.includes(h.toLowerCase()),
  );
}

// ─── Variable Resolution ──────────────────────────────────────────────

/**
 * Resolve template variables from a CSV row given a variableMapping.
 *
 * variableMapping maps WhatsApp template variable positions (1-based string keys)
 * to CSV column header names. E.g. { "1": "name_column", "2": "order_column" }.
 *
 * Returns a record suitable for storage in broadcastRecipients.variables.
 */
function resolveVariables(
  row: string[],
  headers: string[],
  variableMapping: Record<string, string>,
): Record<string, string> {
  const resolved: Record<string, string> = {};

  for (const [position, columnName] of Object.entries(variableMapping)) {
    const colIndex = headers.findIndex(
      (h) => h.toLowerCase() === columnName.toLowerCase(),
    );
    if (colIndex !== -1 && colIndex < row.length) {
      resolved[position] = row[colIndex] ?? '';
    }
  }

  return resolved;
}

// ─── Main Function ────────────────────────────────────────────────────

export interface ParseAndCreateRecipientsResult {
  created: number;
  skipped: number;
  invalid: number;
  errors: string[];
  label?: { id: string; title: string };
}

/**
 * Parse a CSV file and create broadcast recipient rows.
 *
 * Flow per row:
 * 1. Detect phone column by header name
 * 2. Normalise phone (SG-focused, with fallback to normalizeWhatsAppPhone for
 *    numbers already in E.164/international form)
 * 3. Validate — skip and record reason if invalid
 * 4. Find existing contact by phone, or create new contact
 * 5. Skip if contact has marketingOptOut = true
 * 6. Resolve template variables from row data
 * 7. Insert broadcastRecipients row (onConflictDoNothing for duplicate contacts)
 * 8. Update broadcasts.totalRecipients with final created count
 */
export async function parseAndCreateRecipients(
  db: VobaseDb,
  broadcastId: string,
  csvText: string,
  variableMapping: Record<string, string>,
  options?: { saveAsLabel?: string },
): Promise<ParseAndCreateRecipientsResult> {
  const { headers, rows } = parseCSV(csvText);

  const result: ParseAndCreateRecipientsResult = {
    created: 0,
    skipped: 0,
    invalid: 0,
    errors: [],
  };

  const contactIds: string[] = [];

  if (headers.length === 0) {
    result.errors.push('CSV has no headers');
    return result;
  }

  const MAX_RECIPIENTS = 5000;
  if (rows.length > MAX_RECIPIENTS) {
    result.errors.push(
      `CSV exceeds maximum of ${MAX_RECIPIENTS} recipients (got ${rows.length})`,
    );
    return result;
  }

  const phoneColIndex = findPhoneColumnIndex(headers);
  if (phoneColIndex === -1) {
    result.errors.push(
      `No phone column found. Expected one of: ${PHONE_HEADER_PATTERNS.join(', ')}`,
    );
    return result;
  }

  // Phase 1: Validate and normalize all rows, resolve contacts in chunks
  const CHUNK_SIZE = 100;
  const pendingRecipients: Array<{
    contactId: string;
    phone: string;
    variables: Record<string, string>;
  }> = [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    const rowNumber = rowIndex + 2; // +1 for header, +1 for 1-based display

    const rawPhone = row[phoneColIndex] ?? '';

    if (rawPhone === '') {
      result.invalid++;
      result.errors.push(`Row ${rowNumber}: empty phone number`);
      continue;
    }

    const normalizedPhone = normalizeSGPhone(rawPhone);

    if (normalizedPhone === null) {
      result.invalid++;
      result.errors.push(
        `Row ${rowNumber}: invalid phone number "${rawPhone}"`,
      );
      continue;
    }

    // Find or create contact (upsert requires individual calls for returning)
    const [contact] = await db
      .insert(contacts)
      .values({
        phone: normalizedPhone,
        role: 'customer',
        attributes: {},
      })
      .onConflictDoUpdate({
        target: contacts.phone,
        set: {
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!contact) {
      result.invalid++;
      result.errors.push(`Row ${rowNumber}: failed to resolve contact`);
      continue;
    }

    if (contact.marketingOptOut) {
      result.skipped++;
      continue;
    }

    const variables = resolveVariables(row, headers, variableMapping);
    pendingRecipients.push({
      contactId: contact.id,
      phone: normalizedPhone,
      variables,
    });
  }

  // Phase 2: Batch-insert recipients in chunks
  for (let i = 0; i < pendingRecipients.length; i += CHUNK_SIZE) {
    const chunk = pendingRecipients.slice(i, i + CHUNK_SIZE);
    const inserted = await db
      .insert(broadcastRecipients)
      .values(
        chunk.map((r) => ({
          broadcastId,
          contactId: r.contactId,
          phone: r.phone,
          variables: r.variables,
          status: 'queued' as const,
        })),
      )
      .onConflictDoNothing()
      .returning({
        id: broadcastRecipients.id,
        contactId: broadcastRecipients.contactId,
      });

    for (const row of inserted) {
      result.created++;
      contactIds.push(row.contactId);
    }
  }

  // Update totalRecipients on the broadcast
  await db
    .update(broadcasts)
    .set({
      totalRecipients: sql`${broadcasts.totalRecipients} + ${result.created}`,
    })
    .where(eq(broadcasts.id, broadcastId));

  if (options?.saveAsLabel) {
    let [label] = await db
      .select()
      .from(labels)
      .where(eq(labels.title, options.saveAsLabel))
      .limit(1);

    if (!label) {
      [label] = await db
        .insert(labels)
        .values({ title: options.saveAsLabel })
        .returning();
    }

    if (contactIds.length > 0) {
      await db
        .insert(contactLabels)
        .values(
          contactIds.map((contactId) => ({ contactId, labelId: label.id })),
        )
        .onConflictDoNothing();
    }

    result.label = { id: label.id, title: label.title };
  }

  return result;
}
