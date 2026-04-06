import { join } from 'node:path';

let cachedScript: string | null = null;

export async function compileScript(baseUrl: string): Promise<string> {
  const browserDir = join(import.meta.dir, '..', 'browser');
  const entrypoint = join(browserDir, 'runtime.ts');

  const isDev = process.env.NODE_ENV !== 'production';
  if (cachedScript && !isDev) return cachedScript;

  const result = await Bun.build({
    entrypoints: [entrypoint],
    target: 'browser',
    minify: !isDev,
    define: {
      __VOBASE_SERVER_URL__: JSON.stringify(baseUrl),
      __PRODUCT_NAME__: JSON.stringify(
        process.env.VITE_PRODUCT_NAME || 'Vobase',
      ),
    },
  });

  if (!result.success) {
    const errors = result.logs.map((l) => l.message).join('\n');
    throw new Error(`Script compilation failed:\n${errors}`);
  }

  const output = await result.outputs[0].text();

  // Wrap in IIFE if not already (Bun.build with no format may not wrap)
  const iife = output.trimStart().startsWith('(')
    ? output
    : `(function(){\n${output}\n})();`;

  const scriptUrl = `${baseUrl}/api/automation/script.user.js`;
  const header = `// ==UserScript==
// @name         ${process.env.VITE_PRODUCT_NAME || 'Vobase'} Automation
// @namespace    vobase
// @version      ${isDev ? `1.0.${Date.now()}` : '1.0'}
// @description  Browser automation for ${process.env.VITE_PRODUCT_NAME || 'Vobase'}
// @match        https://web.whatsapp.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @connect      ${new URL(baseUrl).hostname}
// @run-at       document-idle
// @downloadURL  ${scriptUrl}
// @updateURL    ${scriptUrl}
// ==/UserScript==

`;

  cachedScript = header + iife;
  return cachedScript;
}
