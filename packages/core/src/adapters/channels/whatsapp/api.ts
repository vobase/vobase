import type { SendResult } from '../../../contracts/channels'
import type { HttpClient } from '../../../http/client'
import type { WhatsAppChannelConfig } from './types'
import { DEFAULT_MEDIA_SIZE_LIMIT, ERROR_CODE_MAP, MEDIA_SIZE_LIMITS, WhatsAppApiError } from './types'

// ─── Helpers ─────────────────────────────────────────────────────────

export function graphUrl(apiVersion: string, path: string): string {
  return `https://graph.facebook.com/${apiVersion}${path}`
}

export async function parseGraphError(res: Response): Promise<never> {
  let body: string | undefined
  try {
    body = await res.text()
  } catch {
    // ignore read errors
  }

  if (body) {
    try {
      const parsed = JSON.parse(body)
      if (parsed.error) {
        const e =
          typeof parsed.error === 'object' && parsed.error !== null
            ? parsed.error
            : { message: typeof parsed.error === 'string' ? parsed.error : undefined }
        throw new WhatsAppApiError(
          e.message ?? `WhatsApp API ${res.status}: ${body.slice(0, 200)}`,
          res.status,
          e.code ?? 0,
          e.error_subcode,
          e.fbtrace_id,
        )
      }
    } catch (err) {
      if (err instanceof WhatsAppApiError) throw err
      // Not valid JSON or no error field — fall through
    }
  }

  throw new WhatsAppApiError(`WhatsApp API ${res.status}: ${body ?? 'unknown error'}`, res.status, 0)
}

/**
 * Split text into chunks of at most `maxLen` characters.
 * Tries paragraph breaks first, then line breaks, then hard cut.
 */
export function chunkText(text: string, maxLen = 4096): string[] {
  if (text.length === 0) return [text]
  if (text.length <= maxLen) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining)
      break
    }

    let splitAt = -1

    // Try paragraph break
    const paraIdx = remaining.lastIndexOf('\n\n', maxLen)
    if (paraIdx > 0) {
      splitAt = paraIdx
    }

    // Try line break
    if (splitAt === -1) {
      const lineIdx = remaining.lastIndexOf('\n', maxLen)
      if (lineIdx > 0) {
        splitAt = lineIdx
      }
    }

    // Hard cut
    if (splitAt === -1) {
      splitAt = maxLen
    }

    chunks.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt).replace(/^\n+/, '')
  }

  return chunks
}

export function errorToSendResult(err: unknown): SendResult {
  const message = err instanceof Error ? err.message : String(err)

  if (err instanceof WhatsAppApiError) {
    // Check mapped error codes
    const mapped = ERROR_CODE_MAP[err.code]
    if (mapped) {
      return {
        success: false,
        error: message,
        code: mapped.code,
        retryable: mapped.retryable,
      }
    }

    // 5xx HTTP status → server error
    if (err.httpStatus >= 500) {
      return {
        success: false,
        error: message,
        code: 'server_error',
        retryable: true,
      }
    }

    // Unknown code — default cautious: retryable
    return {
      success: false,
      error: message,
      code: 'unknown',
      retryable: true,
    }
  }

  // Non-API errors — default cautious: retryable
  return { success: false, error: message, code: 'unknown', retryable: true }
}

// ─── API Client Factory ─────────────────────────────────────────────

export type GraphApiResponse = {
  messages?: Array<{ id: string }>
  url?: string
  mime_type?: string
  wabaId?: string
  data?: unknown[]
  [key: string]: unknown
}

export function createApiClient(config: WhatsAppChannelConfig, httpClient?: HttpClient) {
  const { accessToken } = config
  const apiVersion = config.apiVersion ?? 'v22.0'
  const transport = config.transport

  // ─── transportFetch closure ─────────────────────────────────

  async function transportFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const url = transport ? `${transport.baseUrl}${path}` : graphUrl(apiVersion, path)

    const authHeaders = transport
      ? transport.signRequest(init.method ?? 'GET', new URL(url).pathname)
      : { Authorization: `Bearer ${accessToken}` }

    const res = await fetch(url, {
      ...init,
      headers: { ...authHeaders, ...(init.headers as Record<string, string>) },
    })

    // Intercept proxy-layer errors before they reach parseGraphError
    if (transport && (res.status === 502 || res.status === 503 || res.status === 504)) {
      const body = await res.text().catch(() => '')
      throw new WhatsAppApiError(`Platform proxy ${res.status}: ${body.slice(0, 200) || 'no body'}`, res.status, 0)
    }

    return res
  }

  // ─── graphFetch closure ───────────────────────────────────────

  async function graphFetch(path: string, options: RequestInit = {}): Promise<GraphApiResponse> {
    // Transport mode: always use transportFetch
    if (transport) {
      const res = await transportFetch(path, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers as Record<string, string>),
        },
      })
      if (!res.ok) {
        await parseGraphError(res)
      }
      return res.json() as Promise<GraphApiResponse>
    }

    // Direct mode: existing behavior
    const url = graphUrl(apiVersion, path)
    const authHeaders = { Authorization: `Bearer ${accessToken}` }

    if (httpClient) {
      const method = (options.method ?? 'GET').toLowerCase()
      const headers = {
        ...authHeaders,
        ...(options.headers as Record<string, string> | undefined),
      }

      if (method === 'post' || method === 'put') {
        const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body
        const res = await httpClient[method](url, body, { headers })
        if (!res.ok) {
          const synthetic = new Response(JSON.stringify(res.data), {
            status: res.status,
          })
          await parseGraphError(synthetic)
        }
        return res.data as GraphApiResponse
      } else {
        const res = await httpClient.get(url, { headers })
        if (!res.ok) {
          const synthetic = new Response(JSON.stringify(res.data), {
            status: res.status,
          })
          await parseGraphError(synthetic)
        }
        return res.data as GraphApiResponse
      }
    }

    // Fallback to raw fetch (backward compat / tests)
    const res = await fetch(url, {
      ...options,
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
    if (!res.ok) {
      await parseGraphError(res)
    }
    return res.json() as Promise<GraphApiResponse>
  }

  // ─── downloadMedia closure ────────────────────────────────────

  async function downloadMedia(
    mediaId: string,
    mediaType?: string,
  ): Promise<{ data: Buffer; mimeType: string } | null> {
    const MAX_RETRIES = 2
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const maxSize: number = (mediaType ? MEDIA_SIZE_LIMITS[mediaType] : undefined) ?? DEFAULT_MEDIA_SIZE_LIMIT

        let binRes: Response
        let mimeTypeHint: string | undefined

        if (transport) {
          let downloadUrl: string
          try {
            const meta = await graphFetch(`/${mediaId}`)
            const mediaUrl = meta.url as string
            if (!mediaUrl) return null
            mimeTypeHint = meta.mime_type as string | undefined
            downloadUrl = `${transport.mediaDownloadUrl}?url=${encodeURIComponent(mediaUrl)}`
          } catch {
            downloadUrl = `${transport.mediaDownloadUrl}?mediaId=${encodeURIComponent(mediaId)}`
          }
          const authHeaders = transport.signRequest('GET', new URL(downloadUrl).pathname)
          binRes = await fetch(downloadUrl, { headers: authHeaders })
        } else {
          const meta = await graphFetch(`/${mediaId}`)
          const mediaUrl = meta.url as string
          if (!mediaUrl) return null
          mimeTypeHint = meta.mime_type as string | undefined

          binRes = await fetch(mediaUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
          })
        }
        if (!binRes.ok) return null

        const contentLength = binRes.headers.get('content-length')
        if (contentLength !== null) {
          const size = Number.parseInt(contentLength, 10)
          if (!Number.isNaN(size) && size > maxSize) {
            console.warn(`[WhatsApp] downloadMedia skipped: content-length ${size} exceeds limit ${maxSize}`, {
              mediaId,
              mediaType,
            })
            return null
          }
        }

        const arrayBuf = await binRes.arrayBuffer()

        if (arrayBuf.byteLength > maxSize) {
          console.warn(
            `[WhatsApp] downloadMedia skipped: downloaded ${arrayBuf.byteLength} bytes exceeds limit ${maxSize}`,
            { mediaId, mediaType },
          )
          return null
        }
        return {
          data: Buffer.from(arrayBuf),
          mimeType: mimeTypeHint ?? binRes.headers.get('content-type') ?? 'application/octet-stream',
        }
      } catch (error) {
        if (attempt === MAX_RETRIES) {
          console.error('[WhatsApp] downloadMedia failed after retries:', mediaId, error)
          return null
        }
        console.warn('[WhatsApp] downloadMedia retry:', { mediaId, attempt: attempt + 1 })
        await new Promise<void>((resolve) => setTimeout(resolve, 1_000))
      }
    }
    return null
  }

  return { transportFetch, graphFetch, downloadMedia }
}
