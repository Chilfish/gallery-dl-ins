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
  data: unknown | ((config: FakeRequest) => unknown)
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
        const data = typeof route.data === 'function'
          ? (route.data as (config: FakeRequest) => unknown)(config)
          : route.data
        return {
          status: route.status ?? 200,
          data: data as T,
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
  extra: {
    lsdToken?: { value: string }
    apiBackend?: () => string
  } = {},
): { api: InstagramRestAPI, http: FakeHttp } {
  const http = new FakeHttp(routes)
  const api = new InstagramRestAPI({
    http,
    root: 'https://www.instagram.com',
    csrfToken: { value: 'token' },
    wwwClaim: { value: '0' },
    lsdToken: extra.lsdToken,
    apiBackend: extra.apiBackend,
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

  it('falls back to web,info', () => {
    expect(normalizeUserStrategies(undefined)).toEqual(['web', 'info'])
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
    expect(error?.message).toContain('web:')
    expect(error?.message).toContain('info:')
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

describe('instagramRestAPI doc_id GraphQL', () => {
  const LSD_HTML = '<html><script>"LSD",[],{"token":"lsd-token"}</script></html>'

  function mediaNode(pk: string): Record<string, unknown> {
    return {
      pk,
      code: `code-${pk}`,
      taken_at: 1_700_000_000,
      user: { pk: '9', username: 'testuser', full_name: 'Test User' },
      caption: null,
      like_count: 1,
      image_versions2: {
        candidates: [
          { url: `https://cdn.example/${pk}.jpg`, width: 1, height: 1 },
        ],
      },
    }
  }

  async function collectPosts(
    gen: AsyncGenerator<import('../../src/instagram/types').InstagramPost>,
  ): Promise<import('../../src/instagram/types').InstagramPost[]> {
    const posts: import('../../src/instagram/types').InstagramPost[] = []
    for await (const post of gen)
      posts.push(post)
    return posts
  }

  function requestBody(config: FakeRequest): URLSearchParams {
    return config.data as URLSearchParams
  }

  it('acquires lsd and queries posts with a form-encoded body', async () => {
    const { api, http } = makeApi([
      {
        match: 'i.instagram.com/api/graphql',
        data: JSON.stringify({
          data: {
            xdt_api__v1__feed__user_timeline_graphql_connection: {
              edges: [
                {
                  node: mediaNode('1'),
                },
              ],
              page_info: { has_next_page: false, end_cursor: null },
            },
          },
        }),
      },
      { match: 'https://www.instagram.com/', data: LSD_HTML },
    ])

    const posts = await collectPosts(api.userFeed('9', 'testuser'))
    expect(posts).toHaveLength(1)
    expect(posts[0]?.pk).toBe('1')

    const gql = http.requests.find(req => req.url.includes('i.instagram.com'))
    expect(gql?.method).toBe('POST')
    expect(gql?.data).toBeInstanceOf(URLSearchParams)
    expect(gql?.headers?.['X-FB-LSD']).toBe('lsd-token')
    expect(gql?.headers?.['X-FB-Friendly-Name']).toBe('PolarisProfilePostsQuery')

    const body = requestBody(gql!)
    expect(body.get('doc_id')).toBe('27014165781614298')
    expect(body.get('lsd')).toBe('lsd-token')
    expect(body.get('fb_api_req_friendly_name')).toBe('PolarisProfilePostsQuery')
  })

  it('paginates posts with page_info.end_cursor as the next after value', async () => {
    const { api, http } = makeApi([
      {
        match: 'i.instagram.com/api/graphql',
        data: (config: FakeRequest) => {
          const variables = JSON.parse(requestBody(config).get('variables')!) as {
            after: string | null
          }
          const first = variables.after == null
          return JSON.stringify({
            data: {
              xdt_api__v1__feed__user_timeline_graphql_connection: {
                edges: [
                  {
                    node: mediaNode(first ? '1' : '2'),
                  },
                ],
                page_info: {
                  has_next_page: first,
                  end_cursor: first ? 'cursor-1' : null,
                },
              },
            },
          })
        },
      },
      { match: 'https://www.instagram.com/', data: LSD_HTML },
    ])

    const posts = await collectPosts(api.userFeed('9', 'testuser'))
    expect(posts.map(post => post.pk)).toEqual(['1', '2'])

    const gqlRequests = http.requests.filter(req => req.url.includes('i.instagram.com'))
    expect(gqlRequests).toHaveLength(2)
    const secondVariables = JSON.parse(requestBody(gqlRequests[1]!).get('variables')!)
    expect(secondVariables.after).toBe('cursor-1')
  })

  it('falls back to REST when the lsd token cannot be acquired', async () => {
    const { api } = makeApi([
      {
        match: '/api/v1/feed/user/',
        data: JSON.stringify({
          items: [
            mediaNode('rest-1'),
          ],
          more_available: false,
        }),
      },
      { match: 'https://www.instagram.com/', data: '<html></html>' },
    ])

    const posts = await collectPosts(api.userFeed('9', 'testuser'))
    expect(posts.map(post => post.pk)).toEqual(['rest-1'])
  })

  it('reads the tagged connection edge nodes', async () => {
    const { api, http } = makeApi([
      {
        match: 'i.instagram.com/api/graphql',
        data: JSON.stringify({
          data: {
            xdt_api__v1__usertags__user_id__feed_connection: {
              edges: [
                {
                  node: mediaNode('tagged-1'),
                },
              ],
              page_info: { has_next_page: false, end_cursor: null },
            },
          },
        }),
      },
      { match: 'https://www.instagram.com/', data: LSD_HTML },
    ])

    const posts = await collectPosts(api.userTagged('9'))
    expect(posts.map(post => post.pk)).toEqual(['tagged-1'])

    const gql = http.requests.find(req => req.url.includes('i.instagram.com'))
    expect(requestBody(gql!).get('doc_id')).toBe('29179217291735675')
  })

  it('unwraps node.media for reels edges', async () => {
    const { api, http } = makeApi([
      {
        match: 'i.instagram.com/api/graphql',
        data: JSON.stringify({
          data: {
            fetch__XDTUserDict: {
              clips_connection: {
                edges: [
                  {
                    node: {
                      media: mediaNode('reel-1'),
                    },
                  },
                ],
                page_info: { has_next_page: false, end_cursor: null },
              },
            },
          },
        }),
      },
      { match: 'https://www.instagram.com/', data: LSD_HTML },
    ])

    const posts = await collectPosts(api.userClips('9'))
    expect(posts.map(post => post.pk)).toEqual(['reel-1'])

    const gql = http.requests.find(req => req.url.includes('i.instagram.com'))
    expect(requestBody(gql!).get('doc_id')).toBe('28280418711631396')
  })

  it('resolves userById through the profile doc_id', async () => {
    const { api, http } = makeApi([
      {
        match: 'i.instagram.com/api/graphql',
        data: JSON.stringify({
          data: {
            user: {
              pk: '123',
              username: 'testuser',
              full_name: 'Test User',
              follower_count: 7,
            },
          },
        }),
      },
      { match: 'https://www.instagram.com/', data: LSD_HTML },
    ])

    const user = await api.userById('123')
    expect(user.follower_count).toBe(7)
    expect(user.username).toBe('testuser')

    const gql = http.requests.find(req => req.url.includes('i.instagram.com'))
    expect(requestBody(gql!).get('doc_id')).toBe('28036671149327607')
  })
})

describe('instagramRestAPI error semantics', () => {
  it('reports a 2xx logged-out shell instead of a bare non-JSON error', async () => {
    const { api } = makeApi([
      {
        match: '/api/v1/users/web_profile_info/',
        data: '<html class="no-js not-logged-in">Page Not Found</html>',
      },
    ])

    await expect(api.userByName('testuser')).rejects.toThrow(/not-logged-in/)
  })

  it('surfaces JSON status:"fail" payloads', async () => {
    const { api } = makeApi([
      {
        match: '/api/v1/users/123/info/',
        data: JSON.stringify({
          message: 'Media not found or unavailable',
          status: 'fail',
          status_code: 200,
        }),
      },
    ], undefined, {
      apiBackend: () => 'rest',
    })

    await expect(api.userById('123')).rejects.toThrow(/Media not found or unavailable/)
  })

  it('sends form-encoded bodies for paginated POST endpoints', async () => {
    const { api, http } = makeApi([
      {
        match: '/api/v1/clips/user/',
        data: JSON.stringify({
          items: [],
          paging_info: { more_available: false },
        }),
      },
    ], undefined, {
      apiBackend: () => 'rest',
    })

    await collectPosts(api.userClips('9'))

    const req = http.requests[0]
    expect(req?.method).toBe('POST')
    expect(req?.data).toBeInstanceOf(URLSearchParams)
    expect(req?.headers?.['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect((req!.data as URLSearchParams).get('target_user_id')).toBe('9')
  })

  async function collectPosts(
    gen: AsyncGenerator<import('../../src/instagram/types').InstagramPost>,
  ): Promise<void> {
    for await (const _ of gen) {
      // drain
    }
  }
})
