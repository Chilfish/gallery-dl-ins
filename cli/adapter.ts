/**
 * Node.js adapter — HttpClient + Storage + Logger implementations.
 *
 * These bind the platform-agnostic SDK interfaces to Node.js primitives:
 * axios for HTTP, fs/promises for file I/O, console for logging.
 */

import type { AxiosInstance } from 'axios'
import type { Logger } from '../core/extractor'
import type { HttpClient, HttpResponse, Storage } from '../types'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import axios from 'axios'

// ---------------------------------------------------------------------------
// NodeHttpClient — axios wrapper
// ---------------------------------------------------------------------------

export function createHttpClient(
  sessionId?: string,
): HttpClient {
  const instance: AxiosInstance = axios.create({
    timeout: 30000,
    maxRedirects: 5,
    validateStatus: () => true, // don't throw on non-2xx
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
  })

  // Inject session cookie if provided
  if (sessionId) {
    instance.defaults.headers.Cookie = `sessionid=${sessionId}`
  }

  return {
    async request<T = unknown>(config: {
      url: string
      method?: string
      headers?: Record<string, string>
      params?: Record<string, string | number | null | undefined>
      data?: unknown
      signal?: AbortSignal
      timeout?: number
    }): Promise<HttpResponse<T>> {
      const resp = await instance.request<T>({
        url: config.url,
        method: config.method ?? 'GET',
        headers: config.headers,
        params: cleanupParams(config.params),
        data: config.data,
        signal: config.signal,
        timeout: config.timeout,
      })

      return {
        status: resp.status,
        data: resp.data,
        headers: resp.headers as Record<string, string>,
        url: resp.request?.res?.responseUrl ?? config.url,
      }
    },
  }
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

// ---------------------------------------------------------------------------
// NodeStorage — fs/promises wrapper
// ---------------------------------------------------------------------------

export function createStorage(): Storage {
  return {
    async exists(path: string): Promise<boolean> {
      try {
        await access(path)
        return true
      }
      catch {
        return false
      }
    },

    async write(path: string, data: Uint8Array | string): Promise<void> {
      // Ensure parent directory
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, data)
    },

    async mkdir(path: string): Promise<void> {
      await mkdir(path, { recursive: true })
    },
  }
}

// ---------------------------------------------------------------------------
// NodeLogger — console wrapper
// ---------------------------------------------------------------------------

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
