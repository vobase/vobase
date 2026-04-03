import type { ElementTarget, FlatElement, PageHelpers } from './types';

// TamperMonkey sandbox: `window` is sandboxed, `unsafeWindow` is the page's real window.
declare const unsafeWindow: Window & typeof globalThis;
const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

const INTERACTIVE_TAGS = new Set([
  'button',
  'a',
  'input',
  'textarea',
  'select',
]);
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'checkbox',
  'radio',
  'combobox',
  'tab',
  'menuitem',
  'option',
  'switch',
  'searchbox',
  'spinbutton',
  'slider',
]);

const TAG_IMPLICIT_ROLE: Record<string, string> = {
  button: 'button',
  a: 'link',
  input: 'textbox',
  textarea: 'textbox',
  select: 'combobox',
  checkbox: 'checkbox',
  radio: 'radio',
};

function isElementVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  if (style.opacity === '0') return false;
  if (style.position !== 'fixed' && el.offsetParent === null) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  return true;
}

function isInteractiveElement(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  if (INTERACTIVE_TAGS.has(tag)) return true;

  const role = el.getAttribute('role');
  if (role && INTERACTIVE_ROLES.has(role)) return true;

  const style = window.getComputedStyle(el);
  if (style.cursor === 'pointer') return true;
  if (el.hasAttribute('onclick')) return true;
  if (
    el.hasAttribute('contenteditable') &&
    el.getAttribute('contenteditable') !== 'false'
  )
    return true;

  const tabindex = el.getAttribute('tabindex');
  if (tabindex !== null && tabindex !== '-1') return true;

  return false;
}

function extractFlatElement(el: HTMLElement): FlatElement {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role') ?? TAG_IMPLICIT_ROLE[tag] ?? null;
  const ariaLabel = el.getAttribute('aria-label');
  const titleAttr = el.getAttribute('title');
  const placeholder = el.getAttribute('placeholder');
  const rawText = el.innerText ?? el.textContent ?? '';
  const text = rawText.trim().slice(0, 200);
  const rect = el.getBoundingClientRect();
  const isInteractive = isInteractiveElement(el);

  return {
    element: el,
    tag,
    text,
    role,
    ariaLabel,
    title: titleAttr,
    placeholder,
    isInteractive,
    rect: {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    },
  };
}

function walkDOM(root: HTMLElement, results: FlatElement[]): void {
  const children = root.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i] as HTMLElement;
    if (!isElementVisible(child)) continue;

    const flat = extractFlatElement(child);
    if (flat.isInteractive || flat.text.length > 0) {
      results.push(flat);
    }

    walkDOM(child, results);
  }
}

function flattenDOM(): FlatElement[] {
  const results: FlatElement[] = [];
  if (document.body) {
    walkDOM(document.body, results);
  }
  return results;
}

function findElement(target: ElementTarget): HTMLElement | null {
  const elements = flattenDOM();

  const matches = elements.filter((flat) => {
    if (target.text !== undefined) {
      if (!flat.text.toLowerCase().includes(target.text.toLowerCase()))
        return false;
    }
    if (target.label !== undefined) {
      if (!flat.ariaLabel?.toLowerCase().includes(target.label.toLowerCase()))
        return false;
    }
    if (target.title !== undefined) {
      if (!flat.title?.toLowerCase().includes(target.title.toLowerCase()))
        return false;
    }
    if (target.placeholder !== undefined) {
      if (
        !flat.placeholder
          ?.toLowerCase()
          .includes(target.placeholder.toLowerCase())
      )
        return false;
    }
    if (target.role !== undefined) {
      const effectiveRole = flat.role ?? TAG_IMPLICIT_ROLE[flat.tag];
      if (effectiveRole !== target.role) return false;
    }
    return true;
  });

  if (matches.length === 0) return null;

  const idx = target.nth ?? 0;
  return matches[idx]?.element ?? null;
}

async function clickElement(target: ElementTarget): Promise<void> {
  const el = findElement(target);
  if (!el) {
    const snapshot = captureSnapshot();
    throw new Error(
      `Element not found: ${JSON.stringify(target)}. DOM snapshot:\n${snapshot}`,
    );
  }

  el.scrollIntoView({ block: 'center' });
  await sleep(50);

  const rect = el.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  const pointerOpts = {
    bubbles: true,
    cancelable: true,
    view: pageWindow,
    clientX: centerX,
    clientY: centerY,
    button: 0,
    buttons: 1,
  };

  el.dispatchEvent(new PointerEvent('pointerover', pointerOpts));
  el.dispatchEvent(new MouseEvent('mouseover', pointerOpts));
  el.dispatchEvent(new PointerEvent('pointerdown', pointerOpts));
  el.dispatchEvent(new MouseEvent('mousedown', pointerOpts));

  const focusable = el.tagName.toLowerCase();
  if (
    focusable === 'input' ||
    focusable === 'textarea' ||
    focusable === 'select' ||
    focusable === 'button' ||
    focusable === 'a' ||
    el.hasAttribute('tabindex')
  ) {
    el.focus();
  }

  const upOpts = { ...pointerOpts, buttons: 0 };
  el.dispatchEvent(new PointerEvent('pointerup', upOpts));
  el.dispatchEvent(new MouseEvent('mouseup', upOpts));
  el.dispatchEvent(new MouseEvent('click', upOpts));

  await sleep(100);
}

async function typeInto(target: ElementTarget, value: string): Promise<void> {
  const el = findElement(target);
  if (!el) {
    const snapshot = captureSnapshot();
    throw new Error(
      `Element not found: ${JSON.stringify(target)}. DOM snapshot:\n${snapshot}`,
    );
  }

  el.scrollIntoView({ block: 'center' });
  el.focus();

  const tag = el.tagName.toLowerCase();
  const isEditable =
    el.getAttribute('contenteditable') !== null &&
    el.getAttribute('contenteditable') !== 'false';

  if (tag === 'input' || tag === 'textarea') {
    (el as HTMLInputElement).value = '';
  } else if (isEditable) {
    el.textContent = '';
  }

  el.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      inputType: 'deleteContentBackward',
    }),
  );

  if (tag === 'input' || tag === 'textarea') {
    (el as HTMLInputElement).value = value;
  } else if (isEditable) {
    el.textContent = value;
  }

  el.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: value,
    }),
  );

  el.dispatchEvent(new Event('change', { bubbles: true }));

  await sleep(50);
}

async function waitForElement(
  target: ElementTarget,
  timeoutMs = 10000,
): Promise<HTMLElement> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const el = findElement(target);
    if (el) return el;
    await sleep(200);
  }

  const snapshot = captureSnapshot();
  throw new Error(
    `Element not found: ${JSON.stringify(target)}. DOM snapshot:\n${snapshot}`,
  );
}

function captureSnapshot(): string {
  const elements = flattenDOM();
  const MAX_BYTES = 50 * 1024;

  let output = '';
  for (let i = 0; i < elements.length; i++) {
    const flat = elements[i];
    const roleLabel = flat.role ?? flat.tag;
    let line = `[${i}] ${roleLabel} '${flat.text}'`;
    if (flat.ariaLabel) line += ` (aria-label: ${flat.ariaLabel})`;
    if (flat.title) line += ` (title: ${flat.title})`;
    if (flat.placeholder) line += ` (placeholder: ${flat.placeholder})`;
    line += '\n';

    if (output.length + line.length > MAX_BYTES) break;
    output += line;
  }

  return output;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createPageHelpers(): PageHelpers {
  return {
    flattenDOM,
    findElement,
    clickElement,
    typeInto,
    waitForElement,
    captureSnapshot,
    sleep,
  };
}
