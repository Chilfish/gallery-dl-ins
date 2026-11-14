/**
 * Node.js adapter — HttpClient + Logger implementations.
 *
 * Wires platform-agnostic fetch helpers to Node.js:
 * - ``createHttpClient`` — fetch client with static cookies (CLI session mode)
 * - ``createWebClient``  — fetch client with in-memory cookie jar (anonymous mode)
 * - ``createLogger``     — console-based logger
 */

import type { Logger } from '../core/extractor'
import type { HttpClient } from '../types'
import { createFetchHttpClient, extractCsrf, headersToRecord } from '../fetcher'
import { createCookieJar } from './cookies'

// ── Cookie-based client (CLI session mode) ──

export { extractCsrf as extractCsrfFromCookies }

/**
 * Create an HttpClient with a static cookie string (sessionid cookie).
 *
 * Used by the CLI when ``--cookies`` or ``--sessionid`` is provided.
 */
export function createHttpClient(
  sessionId?: string,
  fullCookies?: string,
  _logger?: Logger,
): HttpClient {
  const baseCookie = fullCookies
    || (sessionId
      ? `sessionid=${sessionId}`
      : null)

  return createFetchHttpClient({
    cookie: baseCookie ?? undefined,
  })
}

// ── Cookie-jar client (anonymous session) ──

/**
 * Create an HTTP client backed by an in-memory cookie jar.
 *
 * Seeds cookies by visiting instagram.com first, then uses those
 * anonymous cookies for subsequent API calls (like incognito browsing).
 *
 * Returns the client + the initial CSRF token extracted from cookies.
 */
export async function createWebClient(
  logger?: Logger,
): Promise<{ http: HttpClient, csrfToken: string }> {
  const jar = createCookieJar()

  // Seed the cookie jar by visiting Instagram's homepage
  logger?.info('Seeding anonymous session (visiting instagram.com)…')
  const seedResp = await fetch('https://www.instagram.com/', {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept':
        'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  })
  jar.setFromResponse(headersToRecord(seedResp.headers))
  const cookieCount = jar.getCookieHeader().split(';').length
  logger?.debug(`  ← ${seedResp.status} — got ${cookieCount} cookies`)

  const csrfToken = extractCsrf(jar.getCookieHeader())

  const http = createFetchHttpClient({
    cookieProvider: () => jar.getCookieHeader(),
    onResponse: headers => jar.setFromResponse(headers),
  })

  return { http, csrfToken }
}

// ── Logger ──

/** Node.js console-based logger. */
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
