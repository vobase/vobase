/**
 * Thin template-side wrapper around `@vobase/core`'s domain-free `llmCall`.
 *
 * Resolves the provider-prefixed model id via `llm-provider.ts` (Bifrost vs
 * direct, env-var key selection) and forwards everything else to core. The
 * barrel is removed in the `declarative-module-collector` follow-on once
 * callers import from `@vobase/core` and pass in a resolved `model` / `apiKey`
 * themselves.
 */

import type { LlmTask } from '@modules/agents/events'
import {
  type LlmEmitter as CoreLlmEmitter,
  type LlmRequest as CoreLlmRequest,
  type LlmResult as CoreLlmResult,
  llmCall as coreLlmCall,
  type WakeScope,
} from '@vobase/core'

import { createModel, resolveApiKey } from './llm-provider'

export type LlmEmitter<TEvent = unknown> = CoreLlmEmitter<TEvent>

export interface LlmRequest extends CoreLlmRequest {
  model?: string
}

export type LlmResult<T = string> = Omit<CoreLlmResult<T>, 'task'> & { task: LlmTask }

export interface LlmCallArgs {
  wake: WakeScope
  task: LlmTask
  request: LlmRequest
  emitter?: LlmEmitter
  parse?: (text: string) => unknown
}

export async function llmCall<T = string>(args: LlmCallArgs): Promise<LlmResult<T>> {
  const model = createModel(args.request.model)
  const apiKey = resolveApiKey(model)
  const res = await coreLlmCall<T>({
    wake: args.wake,
    task: args.task,
    model,
    apiKey,
    request: args.request,
    emitter: args.emitter,
    parse: args.parse,
  })
  return { ...res, task: args.task }
}
