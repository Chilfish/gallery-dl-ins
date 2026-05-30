import type { HttpClient, HttpResponse } from '../../src/types'

interface MockRoute {
  /** URL substring to match (case-insensitive) */
  match: string
  /** Response data */
  data: unknown
  /** Optional HTTP status (default 200) */
  status?: number
}

export class MockHttpClient implements HttpClient {
  private routes: MockRoute[] = []

  /** Add a mock route */
  add(match: string, data: unknown, status = 200): this {
    this.routes.push({ match, data, status })
    return this
  }

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
    const url = config.url.toLowerCase()
    for (const route of this.routes) {
      if (url.includes(route.match.toLowerCase())) {
        return {
          status: route.status ?? 200,
          data: route.data as T,
          headers: {},
          url: config.url,
        }
      }
    }
    // Unmatched — return empty object to avoid crashes
    console.warn(`[MockHTTP] Unmatched request: ${config.url}`)
    return { status: 200, data: {} as T, headers: {}, url: config.url }
  }
}
