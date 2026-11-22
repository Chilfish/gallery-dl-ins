/**
 * Platform-agnostic fetch-based HttpClient factory.
 *
 * Works identically in Node.js (18+) and browsers.
 * CLI and SDK both use this as the default HTTP layer — no external deps.
 */

import type { HttpClient, HttpResponse, RequestConfig } from './types'

// ── Types ──

export interface FetchClientOptions {
  /** Static cookie string to include in every request. */
  cookie?: string
  /**
   * Callback that returns the current cookie string for each request.
   * Used by cookie-jar clients where cookies change over time.
   */
  cookieProvider?: () => string
  /** User-Agent header (default: Chrome 131 on Windows). */
  userAgent?: string
  /** Default request timeout in ms (default: 30000). */
  timeout?: number
  /** Called with response headers after every request. Used for cookie-jar updates. */
  onResponse?: (headers: Record<string, string>) => void
  /**
   * Extra fetch init computed per request (may be async). The Node adapter
   * uses this to attach an undici dispatcher for proxying.
   */
  init?: (config: RequestConfig) => RequestInit | Promise<RequestInit | undefined> | undefined
}

// ── Helpers ──

/** Build URL with query params appended as URLSearchParams. */
export function buildUrl(base: string, params?: Record<string, string | number | null | undefined>): string {
  if (!params)
    return base
  const cleaned: Record<string, string> = {}
  for (const [k, v] of Object.entries(params)) {
    if (v != null)
      cleaned[k] = String(v)
  }
  const entries = Object.entries(cleaned)
  if (entries.length === 0)
    return base
  const qs = new URLSearchParams(entries).toString()
  return `${base}${base.includes('?')
    ? '&'
    : '?'}${qs}`
}

/**
 * Merge cookie strings by name: later values override earlier ones.
 *
 * a=1; b=2 + b=3 → a=1; b=3 (no duplicate ``csrftoken`` headers).
 */
export function mergeCookie(base: string | null, extra: string): string {
  if (!base)
    return extra

  const cookies = new Map<string, string>()
  for (const part of `${base}; ${extra}`.split(';')) {
    const trimmed = part.trim()
    if (!trimmed)
      continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0)
      continue
    cookies.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim())
  }

  return Array.from(cookies, ([name, value]) => `${name}=${value}`).join('; ')
}

/** Extract csrftoken value from a Cookie header string. */
export function extractCsrf(cookies: string): string {
  const m = cookies.match(/(?:^|;\s*)csrftoken=([^;]+)/)
  return m?.[1] ?? ''
}

/** Convert fetch Headers to a plain Record. */
export function headersToRecord(headers: Headers): Record<string, string> {
  const rec: Record<string, string> = {}
  headers.forEach((v, k) => {
    rec[k] = v
  })
  return rec
}

/** Read response body according to the requested type. */
export async function readBody(resp: Response, responseType?: 'arraybuffer' | 'text' | 'json'): Promise<unknown> {
  switch (responseType) {
    case 'arraybuffer': {
      const buf = await resp.arrayBuffer()
      return Buffer.from(buf) // Node.js Buffer extends Uint8Array
    }
    case 'text':
      return resp.text()
    default:
      return resp.json()
  }
}

/** Serialize a request body value for fetch. */
export function serializeBody(data: unknown): string | URLSearchParams | undefined {
  if (data == null)
    return undefined
  if (typeof data === 'string')
    return data
  if (data instanceof URLSearchParams)
    return data
  return JSON.stringify(data)
}

// ── Factory ──

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/**
 * Create a platform-agnostic HttpClient backed by native ``fetch``.
 *
 * Zero dependencies — works in Node.js 18+, browsers, Deno, and Edge.
 *
 * @example Plain (no cookies)
 * ```ts
 * const http = createFetchHttpClient()
 * ```
 *
 * @example With static cookies (CLI session mode)
 * ```ts
 * const http = createFetchHttpClient({ cookie: 'sessionid=abc; csrftoken=xyz' })
 * ```
 *
 * @example With cookie jar (anonymous session)
 * ```ts
 * const jar = createCookieJar()
 * const http = createFetchHttpClient({
 *   cookieProvider: () => jar.getCookieHeader(),
 *   onResponse: (headers) => jar.setFromResponse(headers),
 * })
 * ```
 */
export function createFetchHttpClient(opts: FetchClientOptions = {}): HttpClient {
  const { cookie, cookieProvider, userAgent = UA, timeout = 30000, onResponse } = opts

  return {
    async request<T = unknown>(config: {
      url: string
      method?: string
      headers?: Record<string, string>
      params?: Record<string, string | number | null | undefined>
      data?: unknown
      signal?: AbortSignal
      timeout?: number
      responseType?: 'arraybuffer' | 'text' | 'json'
    }): Promise<HttpResponse<T>> {
      const method = config.method ?? 'GET'
      const url = buildUrl(config.url, config.params)

      // Build headers
      const headers = new Headers(config.headers)
      const reqCookie = cookieProvider?.() ?? cookie
      if (reqCookie) {
        const existing = headers.get('Cookie')
        headers.set('Cookie', existing
          ? mergeCookie(reqCookie, existing)
          : reqCookie)
      }
      if (!headers.has('User-Agent')) {
        headers.set('User-Agent', userAgent)
      }

      // Body
      const body = serializeBody(config.data)
      if (typeof body === 'string' && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json')
      }

      // Timeout — only add our own controller when caller didn't provide a signal
      let controller: AbortController | null = null
      let timer: ReturnType<typeof setTimeout> | null = null
      let signal = config.signal ?? null
      const timeoutMs = config.timeout ?? timeout

      if (!signal) {
        controller = new AbortController()
        timer = setTimeout(() => controller!.abort(), timeoutMs)
        signal = controller.signal
      }

      try {
        const init = await opts.init?.(config)
        const resp = await fetch(url, {
          method,
          headers,
          body,
          signal,
          ...init,
        })

        // Notify cookie jar
        onResponse?.(headersToRecord(resp.headers))

        const data = await readBody(resp, config.responseType)
        return {
          status: resp.status,
          data: data as T,
          headers: headersToRecord(resp.headers),
          url: resp.url,
        }
      }
      catch (err) {
        if (controller?.signal.aborted && !config.signal?.aborted) {
          throw new Error(`Request timeout after ${timeoutMs}ms: ${url}`)
        }
        if (String(err).includes('too many redirect')) {
          throw new Error(
            'Too many redirects — session may be expired or invalid. '
            + 'Export a fresh session from your browser.',
          )
        }
        throw err
      }
      finally {
        if (timer)
          clearTimeout(timer)
      }
    },
  }
}
