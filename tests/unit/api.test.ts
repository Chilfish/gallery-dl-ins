import type { HttpClient, HttpResponse } from '../../src/types'
import { describe, expect, it } from 'vitest'
import { InstagramRestAPI, normalizeUserStrategies } from '../../src/instagram/api'

interface FakeRequest {
  url: string
  method?: string
  headers?: Record<string, string>
  params?: Record<string, string | number | null | undefined>
  data?: unknown
  signal?: AbortSignal
  timeout?: number
  responseType?: 'arraybuffer' | 'text' | 'json'
}

interface FakeRoute {
  match: string
  data: unknown
  status?: number
}

class FakeHttp implements HttpClient {
  readonly requests: FakeRequest[] = []

  constructor(private readonly routes: FakeRoute[]) {}

  async request<T = unknown>(config: FakeRequest): Promise<HttpResponse<T>> {
    this.requests.push(config)
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
    throw new Error(`Unmatched request: ${config.url}`)
  }
}

function makeApi(
  routes: FakeRoute[],
  userStrategies?: () => string[],
): { api: InstagramRestAPI, http: FakeHttp } {
  const http = new FakeHttp(routes)
  const api = new InstagramRestAPI({
    http,
    root: 'https://www.instagram.com',
    csrfToken: { value: 'token' },
    wwwClaim: { value: '0' },
    cursor: { value: null },
    userStrategies,
  })
  return { api, http }
}

describe('normalizeUserStrategies', () => {
  it('splits comma-separated config strings', () => {
    expect(normalizeUserStrategies('search, web')).toEqual(['search', 'web'])
  })

  it('accepts arrays and drops non-strings', () => {
    expect(normalizeUserStrategies(['info', 1, 'web'])).toEqual(['info', 'web'])
  })

  it('falls back to search,web', () => {
    expect(normalizeUserStrategies(undefined)).toEqual(['search', 'web'])
  })
})

describe('instagramRestAPI user resolution', () => {
  it('parses web_profile_info at data.user', async () => {
    const { api } = makeApi([
      {
        match: '/api/v1/users/web_profile_info/',
        data: JSON.stringify({
          data: {
            user: { pk: '123', username: 'testuser', full_name: 'Test User' },
          },
        }),
      },
    ])

    const user = await api.userByName('testuser')
    expect(user.pk).toBe('123')
    expect(user.username).toBe('testuser')
  })

  it('requests responseType text so HTML errors keep their status', async () => {
    const { api, http } = makeApi([
      {
        match: '/api/v1/users/web_profile_info/',
        status: 429,
        data: '',
      },
    ])

    await expect(api.userByName('testuser')).rejects.toThrow(/429/)
    expect(http.requests[0]?.responseType).toBe('text')
  })

  it('includes a body snippet in non-2xx errors', async () => {
    const { api } = makeApi([
      {
        match: '/web/search/topsearch/',
        status: 404,
        data: '<html><body><h1>Page Not Found</h1></body></html>',
      },
    ])

    await expect(api.userBySearch('testuser')).rejects.toThrow(/404.*Page Not Found/)
  })

  it('rejects non-JSON success responses instead of returning empty data', async () => {
    const { api } = makeApi([
      {
        match: '/api/v1/feed/reels_media/',
        status: 200,
        data: '<!DOCTYPE html><html></html>',
      },
    ])

    await expect(api.reelsMedia(['123'])).rejects.toThrow(/non-JSON response/)
  })

  it('extracts the id from page_id profilePage_<id>', async () => {
    const { api } = makeApi([
      {
        match: 'https://www.instagram.com/testuser',
        data: '<html>"page_id":"profilePage_76727580985"</html>',
      },
    ])

    expect(await api.userByWeb('testuser')).toEqual({ id: '76727580985' })
  })

  it('extracts the id from the legacy profile_id field', async () => {
    const { api } = makeApi([
      {
        match: 'https://www.instagram.com/testuser',
        data: '<html>"profile_id":"76727580985"</html>',
      },
    ])

    expect(await api.userByWeb('testuser')).toEqual({ id: '76727580985' })
  })

  it('aggregates strategy failures with their reasons', async () => {
    const { api } = makeApi([
      { match: '/web/search/topsearch/', status: 404, data: 'Not Found' },
      { match: 'https://www.instagram.com/testuser', data: '<html>error shell</html>' },
    ])

    let error: Error | undefined
    try {
      await api.userByScreenName('testuser')
    }
    catch (err) {
      error = err as Error
    }
    expect(error?.message).toContain('User not found: testuser')
    expect(error?.message).toContain('search:')
    expect(error?.message).toContain('web:')
  })

  it('honors a configured user-strategy chain', async () => {
    const { api, http } = makeApi([
      {
        match: '/api/v1/users/web_profile_info/',
        data: JSON.stringify({
          data: {
            user: { pk: '123', username: 'testuser', full_name: 'Test User' },
          },
        }),
      },
    ], () => ['info'])

    const user = await api.userByScreenName('testuser')
    expect(user.pk).toBe('123')
    expect(http.requests).toHaveLength(1)
    expect(http.requests[0]?.url).toContain('web_profile_info')
  })

  it('reports unknown strategies', async () => {
    const { api } = makeApi([], () => ['nope'])
    await expect(api.userByScreenName('testuser')).rejects.toThrow(/nope: unknown strategy/)
  })
})
