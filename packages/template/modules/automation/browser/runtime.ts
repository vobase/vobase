import { whatsappAdapter } from './adapters/whatsapp';
import { createPageHelpers } from './page-helpers';
import type { Adapter, TaskPayload, TaskReport } from './types';

// ─── Configuration ──────────────────────────────────────────────────
declare const __VOBASE_SERVER_URL__: string;
const SERVER_URL =
  typeof __VOBASE_SERVER_URL__ !== 'undefined'
    ? __VOBASE_SERVER_URL__
    : window.location.origin;

// ─── Adapter Registry ───────────────────────────────────────────────
const adapters: Adapter[] = [whatsappAdapter];

// ─── GM_* API Declarations ──────────────────────────────────────────
declare function GM_xmlhttpRequest(details: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  data?: string;
  onload: (response: { status: number; responseText: string }) => void;
  onerror: (error: unknown) => void;
}): void;
declare function GM_setValue(key: string, value: string): void;
declare function GM_getValue(key: string, defaultValue?: string): string;
declare function GM_addStyle(css: string): void;

// ─── HTTP Helper ────────────────────────────────────────────────────
function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T | null }> {
  return new Promise((resolve, reject) => {
    const apiKey = GM_getValue('vobase_api_key', '');
    GM_xmlhttpRequest({
      method,
      url: `${SERVER_URL}/api/automation${path}`,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      data: body ? JSON.stringify(body) : undefined,
      onload(response) {
        let data: T | null = null;
        if (response.responseText) {
          try {
            data = JSON.parse(response.responseText) as T;
          } catch {
            // Server returned non-JSON (e.g., HTML error page)
          }
        }
        resolve({ status: response.status, data });
      },
      onerror(error) {
        reject(error);
      },
    });
  });
}

// ─── State ──────────────────────────────────────────────────────────
let isPaired = false;
let isExecuting = false;

// ─── Status Badge UI ────────────────────────────────────────────────
let badgeEl: HTMLElement | null = null;

function createStatusBadge(): void {
  const badge = document.createElement('div');
  badge.className = 'vobase-overlay vobase-badge vobase-badge--disconnected';
  badge.innerHTML = '<span class="vobase-dot"></span> Vobase';
  badge.title = 'Vobase Automation';

  // Drag state
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let wasDragged = false;

  badge.addEventListener('mousedown', (e) => {
    isDragging = true;
    wasDragged = false;
    dragStartX = e.clientX - badge.getBoundingClientRect().left;
    dragStartY = e.clientY - badge.getBoundingClientRect().top;
    badge.style.transition = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    wasDragged = true;
    badge.style.right = 'auto';
    badge.style.bottom = 'auto';
    badge.style.left = `${e.clientX - dragStartX}px`;
    badge.style.top = `${e.clientY - dragStartY}px`;
  });

  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    badge.style.transition = 'all 0.2s ease';
    // Snap to nearest corner
    const rect = badge.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const snapRight = centerX > window.innerWidth / 2;
    const snapBottom = centerY > window.innerHeight / 2;
    if (snapRight) {
      badge.style.right = '20px';
      badge.style.left = 'auto';
    } else {
      badge.style.left = '20px';
      badge.style.right = 'auto';
    }
    if (snapBottom) {
      badge.style.bottom = '20px';
      badge.style.top = 'auto';
    } else {
      badge.style.top = '20px';
      badge.style.bottom = 'auto';
    }
  });

  badge.addEventListener('click', () => {
    if (!wasDragged && !isPaired && !pairingPanelEl) showPairingUI();
  });

  document.body.appendChild(badge);
  badgeEl = badge;
}

function updateBadge(status: string): void {
  if (!badgeEl) return;
  badgeEl.className = `vobase-overlay vobase-badge vobase-badge--${status}`;
  const labels: Record<string, string> = {
    connected: 'Vobase',
    executing: 'Executing\u2026',
    error: 'Error',
    disconnected: 'Vobase (unpaired)',
  };
  badgeEl.innerHTML = `<span class="vobase-dot"></span> ${labels[status] ?? 'Vobase'}`;
}

// ─── Pairing UI ─────────────────────────────────────────────────────
let pairingPanelEl: HTMLElement | null = null;

function showPairingUI(): void {
  if (pairingPanelEl) return;

  const panel = document.createElement('div');
  panel.className = 'vobase-overlay vobase-panel';

  const title = document.createElement('h2');
  title.textContent = 'Vobase Automation';
  title.style.cssText =
    'margin:0 0 16px;font-size:18px;color:#111;padding-right:24px;';
  panel.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '&#10005;';
  closeBtn.style.cssText =
    'position:absolute;top:20px;right:20px;background:none;border:none;font-size:14px;color:#9ca3af;cursor:pointer;padding:0;line-height:1;';
  closeBtn.addEventListener('click', () => {
    panel.remove();
    pairingPanelEl = null;
  });
  panel.appendChild(closeBtn);

  const hint = document.createElement('p');
  hint.style.cssText = 'color:#6b7280;font-size:13px;margin:0 0 12px;';
  hint.textContent =
    'Enter the 8-character pairing code from your Vobase dashboard.';
  panel.appendChild(hint);

  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'vobase-code-input';
  input.maxLength = 8;
  input.placeholder = 'XXXXXXXX';
  input.autocomplete = 'off';
  panel.appendChild(input);

  const btn = document.createElement('button');
  btn.className = 'vobase-btn-primary';
  btn.textContent = 'Pair';
  panel.appendChild(btn);

  const errorEl = document.createElement('div');
  errorEl.className = 'vobase-error';
  errorEl.style.display = 'none';
  panel.appendChild(errorEl);

  document.body.appendChild(panel);
  pairingPanelEl = panel;
  input.focus();

  const doSubmit = async () => {
    const code = input.value.trim().toLowerCase();
    if (code.length !== 8) {
      errorEl.textContent = 'Code must be exactly 8 characters.';
      errorEl.style.display = 'block';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Pairing\u2026';
    errorEl.style.display = 'none';

    try {
      const { status, data } = await apiRequest<{ apiKey: string }>(
        'POST',
        '/pairing/redeem',
        { code, browserInfo: { userAgent: navigator.userAgent } },
      );

      if (status === 200 && data?.apiKey) {
        GM_setValue('vobase_api_key', data.apiKey);
        isPaired = true;

        panel.remove();
        pairingPanelEl = null;
        updateBadge('connected');
      } else {
        const errObj = data as Record<string, unknown> | null;
        const msg =
          typeof errObj?.message === 'string'
            ? errObj.message
            : typeof errObj?.error === 'string'
              ? errObj.error
              : 'Invalid code. Please try again.';
        errorEl.textContent = msg;
        errorEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Pair';
      }
    } catch {
      errorEl.textContent = 'Network error. Please try again.';
      errorEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Pair';
    }
  };

  btn.addEventListener('click', doSubmit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSubmit();
  });
}

// ─── Approval Dialog ────────────────────────────────────────────────
function showApprovalDialog(task: TaskPayload): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement('div');
    dialog.className = 'vobase-overlay vobase-dialog';

    const heading = document.createElement('h3');
    heading.textContent = 'Approve automation?';
    dialog.appendChild(heading);

    const desc = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = task.adapterId;
    desc.appendChild(strong);
    desc.appendChild(document.createTextNode(` \u2014 ${task.action}`));
    dialog.appendChild(desc);

    const buttons = document.createElement('div');
    buttons.className = 'vobase-dialog-buttons';

    const approveBtn = document.createElement('button');
    approveBtn.className = 'vobase-btn-approve';
    approveBtn.textContent = 'Approve';
    buttons.appendChild(approveBtn);

    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'vobase-btn-reject';
    rejectBtn.textContent = 'Reject';
    buttons.appendChild(rejectBtn);

    dialog.appendChild(buttons);
    document.body.appendChild(dialog);

    const cleanup = (result: boolean) => {
      dialog.remove();
      resolve(result);
    };

    approveBtn.addEventListener('click', () => cleanup(true));
    rejectBtn.addEventListener('click', () => cleanup(false));
  });
}

// ─── Task Execution ─────────────────────────────────────────────────
async function executeTask(task: TaskPayload): Promise<void> {
  const helpers = createPageHelpers();

  const adapter = adapters.find((a) => a.match.test(window.location.href));
  if (!adapter || adapter.id !== task.adapterId) {
    await reportResult({
      taskId: task.taskId,
      status: 'failed',
      error: `Navigate to the target site for adapter "${task.adapterId}" first.`,
    });
    return;
  }

  const action = adapter.actions[task.action];
  if (!action) {
    await reportResult({
      taskId: task.taskId,
      status: 'failed',
      error: `Unknown action: ${task.action}`,
    });
    return;
  }

  if (task.requiresApproval) {
    const approved = await showApprovalDialog(task);
    if (!approved) {
      await reportResult({ taskId: task.taskId, status: 'cancelled' });
      return;
    }
  }

  try {
    isExecuting = true;
    updateBadge('executing');
    const result = await action.execute(task.input, helpers);
    if (result.success) {
      await reportResult({
        taskId: task.taskId,
        status: 'completed',
        output: result.output,
      });
    } else {
      await reportResult({
        taskId: task.taskId,
        status: 'failed',
        error: result.error,
        domSnapshot: helpers.captureSnapshot(),
      });
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await reportResult({
      taskId: task.taskId,
      status: 'failed',
      error: errorMsg,
      domSnapshot: helpers.captureSnapshot(),
    });
  } finally {
    isExecuting = false;
    updateBadge('connected');
  }
}

async function reportResult(report: TaskReport): Promise<void> {
  await apiRequest('POST', '/script/report', report);
}

// ─── Poll Loop ──────────────────────────────────────────────────────
async function pollForTasks(): Promise<void> {
  if (!isPaired || isExecuting) return;

  try {
    const { status, data } = await apiRequest<TaskPayload>(
      'GET',
      '/script/poll',
    );
    if (status === 401) {
      GM_setValue('vobase_api_key', '');
      isPaired = false;
      updateBadge('disconnected');
      showPairingUI();
      return;
    }
    if (status === 200 && data) {
      await executeTask(data);
    }
    updateBadge('connected');
  } catch {
    updateBadge('error');
  }
}

// ─── Heartbeat ──────────────────────────────────────────────────────
async function sendHeartbeat(): Promise<void> {
  if (!isPaired) return;
  try {
    const { status } = await apiRequest('POST', '/script/heartbeat');
    if (status === 401) {
      GM_setValue('vobase_api_key', '');
      isPaired = false;
      updateBadge('disconnected');
      showPairingUI();
    }
  } catch {
    /* ignore heartbeat failures */
  }
}

// ─── Main Entry Point ───────────────────────────────────────────────
(function main() {
  GM_addStyle(
    [
      ".vobase-overlay { position: fixed; z-index: 99999; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }",
      '.vobase-badge { bottom: 20px; right: 20px; padding: 6px 12px; border-radius: 20px; font-size: 12px; color: white; cursor: grab; box-shadow: 0 2px 8px rgba(0,0,0,0.15); display: flex; align-items: center; gap: 6px; user-select: none; transition: all 0.2s ease; }',
      '.vobase-badge:active { cursor: grabbing; }',
      '.vobase-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex-shrink: 0; }',
      '.vobase-badge--connected { background: #22c55e; }',
      '.vobase-badge--executing { background: #eab308; }',
      '.vobase-badge--error { background: #ef4444; }',
      '.vobase-badge--disconnected { background: #6b7280; }',
      '.vobase-panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; border-radius: 12px; padding: 24px; box-shadow: 0 4px 24px rgba(0,0,0,0.15); width: 360px; }',
      '.vobase-panel input { width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 16px; font-family: monospace; text-align: center; letter-spacing: 4px; margin-bottom: 12px; box-sizing: border-box; }',
      '.vobase-panel .vobase-btn-primary { width: 100%; padding: 8px; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; }',
      '.vobase-panel .vobase-btn-primary { background: #18181b; color: white; }',
      '.vobase-panel .vobase-btn-primary:hover { background: #27272a; }',
      '.vobase-panel .vobase-error { color: #ef4444; font-size: 12px; margin-top: 8px; }',
      '.vobase-dialog { top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; border-radius: 12px; padding: 24px; box-shadow: 0 4px 24px rgba(0,0,0,0.15); width: 360px; }',
      '.vobase-dialog h3 { margin: 0 0 8px; font-size: 16px; color: #111; }',
      '.vobase-dialog p { margin: 0 0 16px; color: #6b7280; font-size: 14px; }',
      '.vobase-dialog-buttons { display: flex; gap: 8px; }',
      '.vobase-dialog-buttons button { flex: 1; padding: 8px; border: none; border-radius: 6px; font-size: 14px; cursor: pointer; }',
      '.vobase-btn-approve { background: #22c55e; color: white; }',
      '.vobase-btn-reject { background: #ef4444; color: white; }',
    ].join('\n'),
  );

  const storedKey = GM_getValue('vobase_api_key', '');
  if (storedKey) {
    isPaired = true;
  }

  createStatusBadge();
  updateBadge(isPaired ? 'connected' : 'disconnected');

  if (!isPaired) {
    showPairingUI();
  }

  setInterval(pollForTasks, 3000);
  setInterval(sendHeartbeat, 30000);
})();
