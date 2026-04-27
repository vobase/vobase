export type JsonPatchOp =
  | { op: 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'replace'; path: string; value: unknown }
  | { op: 'move'; from: string; path: string }
  | { op: 'copy'; from: string; path: string }
  | { op: 'test'; path: string; value: unknown }

export type ChangePayload =
  | { kind: 'markdown_patch'; mode: 'append' | 'replace'; field: string; body: string }
  | { kind: 'field_set'; fields: Record<string, { from: unknown; to: unknown }> }
  | { kind: 'json_patch'; ops: JsonPatchOp[] }

export type ChangePayloadKind = ChangePayload['kind']
