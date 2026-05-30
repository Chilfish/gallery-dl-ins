/**
 * Node.js adapter — HttpClient + Storage + Logger implementations.
 *
 * These bind the platform-agnostic SDK interfaces to Node.js primitives:
 * axios for HTTP, fs/promises for file I/O, console for logging.
 */

import type { AxiosInstance } from 'axios'
import type { Logger } from '../core/extractor'
import type { HttpClient, HttpResponse } from '../types'
import axios from 'axios'
import { createCookieJar } from './cookies'

/** NodeHttpClient — axios wrapper */

/**
 * Extract csrftoken value from a Cookie header string.
 */
export function extractCsrfFromCookies(cookies: string): string {
  const m = cookies.match(/(?:^|;\s*)csrftoken=([^;]+)/)
  return m?.[1] ?? ''
}

export function createHttpClient(
  sessionId?: string,
  fullCookies?: string,
  logger?: Logger,
): HttpClient {
  const instance: AxiosInstance = axios.create({
    timeout: 30000,
    maxRedirects: 20,
    validateStatus: () => true, // don't throw on non-2xx
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
  })

  // Build base Cookie string
  // Priority: full cookies string > sessionid-only
  const baseCookie = fullCookies
    || (sessionId ? `sessionid=${sessionId}` : null)

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
      logger?.debug(`${method} ${config.url}`)

      // Merge base cookie with per-request headers (Cookie values are joined)
      const mergedHeaders: Record<string, string> = {}
      if (baseCookie) {
        mergedHeaders.Cookie = baseCookie
      }
      if (config.headers) {
        for (const [k, v] of Object.entries(config.headers)) {
          if (k.toLowerCase() === 'cookie' && mergedHeaders.Cookie) {
            // Append instead of overriding: sessionid=xxx + csrftoken=yyy → sessionid=xxx; csrftoken=yyy
            mergedHeaders.Cookie = `${mergedHeaders.Cookie}; ${v}`
          }
          else {
            mergedHeaders[k] = v
          }
        }
      }

      if (mergedHeaders.Cookie) {
        logger?.debug(`  Cookie: ${mergedHeaders.Cookie.slice(0, 200)}`)
      }

      try {
        const resp = await instance.request<T>({
          url: config.url,
          method,
          headers: mergedHeaders,
          params: cleanupParams(config.params),
          data: config.data,
          signal: config.signal,
          timeout: config.timeout,
          responseType: config.responseType ?? 'json',
        })

        const finalUrl = resp.request?.res?.responseUrl ?? config.url
        logger?.debug(`  ← ${resp.status} ${resp.status >= 400 ? '⚠️' : ''} (${finalUrl.slice(0, 100)})`)

        return {
          status: resp.status,
          data: resp.data,
          headers: resp.headers as Record<string, string>,
          url: finalUrl,
        }
      }
      catch (err) {
        const msg = String(err)
        if (msg.includes('TOO_MANY_REDIRECTS') || msg.includes('too many redirects')) {
          throw new Error(
            'Too many redirects — sessionid may be expired or invalid. '
            + 'Export a fresh sessionid from your browser.',
          )
        }
        throw err
      }
    },
  }
}

/** WebClient — anonymous cookie-jar HTTP client */

/**
 * Create an HTTP client with an in-memory cookie jar.
 *
 * Use this when you don't have a sessionid — the client first seeds its
 * cookie jar by visiting ``instagram.com``, then uses those anonymous
 * cookies for subsequent API calls.  This is how incognito browsing works.
 *
 * Returns the client + the initial CSRF token extracted from cookies.
 */
export async function createWebClient(
  logger?: Logger,
): Promise<{ http: HttpClient, csrfToken: string }> {
  const jar = createCookieJar()

  // Seed the cookie jar by visiting Instagram's homepage
  logger?.info('Seeding anonymous session (visiting instagram.com)…')
  const seedResp = await axios.get('https://www.instagram.com/', {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept':
        'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    maxRedirects: 20,
    validateStatus: () => true,
  })
  jar.setFromResponse(seedResp.headers as Record<string, string>)
  logger?.debug(`  ← ${seedResp.status} — got ${jar.getCookieHeader().split(';').length} cookies`)

  // Extract csrftoken from jar
  const cookieStr = jar.getCookieHeader()
  const csrfMatch = cookieStr.match(/(?:^|;\s*)csrftoken=([^;]+)/)
  const csrfToken = csrfMatch?.[1] ?? ''

  // Build the wrapper
  const http: HttpClient = {
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
      logger?.debug(`${method} ${config.url}`)

      // Merge jar cookies with per-request headers (Cookie values are joined)
      const jarCookie = jar.getCookieHeader()
      const mergedHeaders: Record<string, string> = {}
      if (jarCookie) {
        mergedHeaders.Cookie = jarCookie
      }
      if (config.headers) {
        for (const [k, v] of Object.entries(config.headers)) {
          if (k.toLowerCase() === 'cookie' && mergedHeaders.Cookie) {
            mergedHeaders.Cookie = `${mergedHeaders.Cookie}; ${v}`
          }
          else {
            mergedHeaders[k] = v
          }
        }
      }

      try {
        const resp = await axios.request<T>({
          url: config.url,
          method,
          headers: mergedHeaders,
          params: cleanupParams(config.params),
          data: config.data,
          signal: config.signal,
          timeout: config.timeout ?? 30000,
          maxRedirects: 20,
          validateStatus: () => true,
          responseType: config.responseType ?? 'json',
        })

        // Update jar with response cookies
        jar.setFromResponse(resp.headers as Record<string, string>)

        const finalUrl = resp.request?.res?.responseUrl ?? config.url
        logger?.debug(`  ← ${resp.status} ${resp.status >= 400 ? '⚠️' : ''} (${finalUrl.slice(0, 100)})`)

        return {
          status: resp.status,
          data: resp.data,
          headers: resp.headers as Record<string, string>,
          url: finalUrl,
        }
      }
      catch (err) {
        const msg = String(err)
        if (msg.includes('TOO_MANY_REDIRECTS') || msg.includes('too many redirects')) {
          throw new Error(
            'Too many redirects — Instagram may be blocking the request. Try again later or use --sessionid.',
          )
        }
        throw err
      }
    },
  }

  return { http, csrfToken }
}

function cleanupParams(
  params?: Record<string, string | number | null | undefined>,
): Record<string, string> | undefined {
  if (!params)
    return undefined
  const cleaned: Record<string, string> = {}
  for (const [k, v] of Object.entries(params)) {
    if (v != null)
      cleaned[k] = String(v)
  }
  return cleaned
}

/** NodeLogger — console wrapper */

export function createLogger(verbose: boolean): Logger {
  return {
    debug(message: string, ...args: unknown[]): void {
      if (verbose)
        console.debug(`[debug] ${message}`, ...args)
    },
    info(message: string, ...args: unknown[]): void {
      console.info(`[info] ${message}`, ...args)
    },
    warn(message: string, ...args: unknown[]): void {
      console.warn(`[warn] ${message}`, ...args)
    },
    error(message: string, ...args: unknown[]): void {
      console.error(`[error] ${message}`, ...args)
    },
  }
}
