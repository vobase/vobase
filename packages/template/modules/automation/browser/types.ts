export interface ElementTarget {
  /** Match by visible text content */
  text?: string;
  /** Match by aria-label attribute */
  label?: string;
  /** Match by title attribute */
  title?: string;
  /** Match by placeholder attribute */
  placeholder?: string;
  /** Match by ARIA role */
  role?: string;
  /** Select nth match when multiple elements match (0-indexed) */
  nth?: number;
}

export interface PageHelpers {
  flattenDOM(): FlatElement[];
  findElement(target: ElementTarget): HTMLElement | null;
  clickElement(target: ElementTarget): Promise<void>;
  typeInto(target: ElementTarget, value: string): Promise<void>;
  waitForElement(
    target: ElementTarget,
    timeoutMs?: number,
  ): Promise<HTMLElement>;
  captureSnapshot(): string;
  sleep(ms: number): Promise<void>;
}

export interface FlatElement {
  element: HTMLElement;
  tag: string;
  text: string;
  role: string | null;
  ariaLabel: string | null;
  title: string | null;
  placeholder: string | null;
  isInteractive: boolean;
  rect: { top: number; left: number; width: number; height: number };
}

interface AdapterAction {
  name: string;
  requiresApproval: boolean;
  execute: (
    input: Record<string, unknown>,
    helpers: PageHelpers,
  ) => Promise<AdapterResult>;
}

export interface Adapter {
  id: string;
  name: string;
  match: RegExp;
  actions: Record<string, AdapterAction>;
}

interface AdapterResult {
  success: boolean;
  output?: Record<string, unknown>;
  error?: string;
}

export interface TaskPayload {
  taskId: string;
  adapterId: string;
  action: string;
  input: Record<string, unknown>;
  requiresApproval: boolean;
}

export interface TaskReport {
  taskId: string;
  status: 'completed' | 'failed' | 'cancelled';
  output?: Record<string, unknown>;
  error?: string;
  domSnapshot?: string;
}
