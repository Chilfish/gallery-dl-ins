/**
 * Instagram REST API client.
 *
 * All endpoint methods return ``AsyncGenerator`` for paginated lists or
 * plain values for single-item endpoints.
 */

import type { HttpClient, HttpResponse } from '../types'
import type {
  InstagramPost,
  InstagramUser,
} from './types'
import { idFromShortcode } from '../utils/id-codec'

const APP_ID = '936619743392459'
const ASBD_ID = '129477'

export class InstagramRestAPI {
  private readonly http: HttpClient
  private readonly root: string
  private readonly getCsrf: () => string
  private readonly getWwwClaim: () => string
  private readonly setWwwClaim: (v: string) => void
  private readonly setCsrf: (v: string) => void

  /** A ref to the extractor's cursor. */
  private getCursor: () => string | null
  private setCursor: (v: string | null) => string | null

  constructor(opts: {
    http: HttpClient
    root: string
    csrfToken: { value: string }
    wwwClaim: { value: string }
    cursor: { value: string | null }
  }) {
    this.http = opts.http
    this.root = opts.root

    this.getCsrf = () => opts.csrfToken.value
    this.setCsrf = (v) => {
      opts.csrfToken.value = v
    }
    this.getWwwClaim = () => opts.wwwClaim.value
    this.setWwwClaim = (v) => {
      opts.wwwClaim.value = v
    }
    this.getCursor = () => opts.cursor.value
    this.setCursor = (v) => {
      opts.cursor.value = v
      return v
    }
  }

  /** Public endpoint methods */

  /** Single post by shortcode. */
  async* media(shortcode: string): AsyncGenerator<InstagramPost> {
    // Trim shortcode if it happens to be the full "long" form
    const sc = shortcode.length > 28 ? shortcode.slice(0, -28) : shortcode
    const numericId = idFromShortcode(sc)
    const endpoint = `/v1/media/${numericId}/info/`
    yield* this._pagination(endpoint)
  }

  /** Paginated user feed. */
  userFeed(userId: string): AsyncGenerator<InstagramPost> {
    return this._pagination(`/v1/feed/user/${userId}/`, { count: 30 })
  }

  /** Paginated user reels (POST endpoint). */
  userClips(userId: string): AsyncGenerator<InstagramPost> {
    const data: Record<string, unknown> = {
      target_user_id: userId,
      page_size: '50',
      max_id: null,
      include_feed_video: 'true',
    }
    return this._paginationPost('/v1/clips/user/', data)
  }

  /** Paginated tagged posts. */
  userTagged(userId: string): AsyncGenerator<InstagramPost> {
    return this._pagination(`/v1/usertags/${userId}/feed/`, { count: 20 })
  }

  /** Paginated saved posts (media wrapper). */
  userSaved(): AsyncGenerator<InstagramPost> {
    return this._pagination('/v1/feed/saved/posts/', { count: 50 }, true)
  }

  /** Paginated collection. */
  userCollection(collectionId: string): AsyncGenerator<InstagramPost> {
    return this._pagination(
      `/v1/feed/collection/${collectionId}/posts/`,
      { count: 50 },
      true,
    )
  }

  /** Reels media — batch call, returns full reel objects. */
  async reelsMedia(reelIds: string[]): Promise<InstagramPost[]> {
    const data = await this._call('/v1/feed/reels_media/', {
      params: { reel_ids: reelIds },
    })
    if (data && typeof data === 'object') {
      const reels = (data as Record<string, unknown>).reels_media
      if (Array.isArray(reels))
        return reels as InstagramPost[]
    }
    throw new Error('Auth required — authenticated cookies needed for reels')
  }

  /** Story tray. */
  async reelsTray(): Promise<InstagramPost[]> {
    const data = await this._call('/v1/feed/reels_tray/')
    if (data && typeof data === 'object') {
      const tray = (data as Record<string, unknown>).tray
      if (Array.isArray(tray))
        return tray as InstagramPost[]
    }
    return []
  }

  /** Highlights list (tray). */
  async highlightsTray(userId: string): Promise<{ id: string }[]> {
    const data = await this._call(
      `/v1/highlights/${userId}/highlights_tray/`,
    )
    if (data && typeof data === 'object') {
      return ((data as Record<string, unknown>).tray ?? []) as { id: string }[]
    }
    return []
  }

  /** All highlights' media batched by ``chunkSize``. */
  async* highlightsMedia(
    userId: string,
    chunkSize = 5,
  ): AsyncGenerator<InstagramPost> {
    const tray = await this.highlightsTray(userId)
    const ids = tray.map(hl => hl.id)

    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize)
      const reels = await this.reelsMedia(chunk)
      yield* reels
    }
  }

  /** Hashtag posts (via sections). */
  async* tagsMedia(tag: string): AsyncGenerator<InstagramPost> {
    for await (const section of this.tagsSections(tag)) {
      const layout = section.layout_content as Record<string, unknown> | undefined
      const medias = (layout?.medias ?? []) as Array<Record<string, unknown>>
      for (const m of medias) {
        if (m.media)
          yield m.media as InstagramPost
      }
    }
  }

  private async* tagsSections(
    tag: string,
  ): AsyncGenerator<Record<string, unknown>> {
    const data: Record<string, unknown> = {
      include_persistent: '0',
      max_id: null,
      page: null,
      surface: 'grid',
      tab: 'recent',
    }
    yield* this._paginationSections(`/v1/tags/${tag}/sections/`, data)
  }

  /** User by numeric ID. */
  async userById(userId: string): Promise<InstagramUser> {
    const data = await this._call(`/v1/users/${userId}/info/`)
    if (data && typeof data === 'object') {
      return (data as Record<string, unknown>).user as InstagramUser
    }
    throw new Error('User not found')
  }

  /** User by username (web_profile_info). */
  async userByName(username: string): Promise<InstagramUser> {
    const data = await this._call('/v1/users/web_profile_info/', {
      params: { username },
    })
    if (data && typeof data === 'object') {
      return (data as Record<string, unknown>).data as InstagramUser
    }
    throw new Error('User not found')
  }

  /** Search user by username. */
  async userBySearch(username: string): Promise<InstagramUser> {
    const url = 'https://www.instagram.com/web/search/topsearch/'
    const data = await this._call(url, { params: { query: username } })
    if (data && typeof data === 'object') {
      const users = (data as Record<string, unknown>).users as Array<{ user: InstagramUser }> | undefined
      if (users) {
        const name = username.toLowerCase()
        for (const result of users) {
          if (result.user.username.toLowerCase() === name) {
            return result.user
          }
        }
      }
    }
    throw new Error('User not found')
  }

  /** Scrape user ID from HTML profile page. */
  async userByWeb(username: string): Promise<{ id: string }> {
    const resp = await this.http.request({
      url: `https://www.instagram.com/${username}`,
      headers: {
        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Alt-Used': 'www.instagram.com',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Priority': 'u=0, i',
      },
    })
    const text = typeof resp.data === 'string' ? resp.data : ''
    const idx = text.indexOf('"profile_id":"')
    if (idx >= 0) {
      const start = idx + 15
      const end = text.indexOf('"', start)
      if (end > start)
        return { id: text.slice(start, end) }
    }
    throw new Error('User not found')
  }

  /** Resolve screen name via fallback chain: search → info → web. */
  async userByScreenName(screenName: string): Promise<InstagramUser> {
    for (const strategy of ['search', 'info', 'web']) {
      try {
        if (strategy === 'search')
          return await this.userBySearch(screenName)
        if (strategy === 'info')
          return await this.userByName(screenName)
        if (strategy === 'web') {
          const result = await this.userByWeb(screenName)
          return { pk: result.id, id: result.id, username: screenName, full_name: '' }
        }
      }
      catch {
        // try next strategy
      }
    }
    throw new Error('User not found')
  }

  /** Resolve username/id to numeric user ID string. */
  async userId(screenName: string, checkPrivate = true): Promise<string> {
    if (screenName.startsWith('id:')) {
      return screenName.slice(3)
    }
    const user = await this.userByScreenName(screenName)
    if (checkPrivate && user.is_private && !user.followed_by_viewer) {
      // warn, but proceed
    }
    return user.id ?? user.pk
  }

  /** Followers (paginated). */
  async* userFollowers(
    userId: string,
  ): AsyncGenerator<InstagramUser> {
    const params: Record<string, unknown> = { count: 12, max_id: null }
    yield* this._paginationFollowing(
      `/v1/friendships/${userId}/followers/`,
      params,
    )
  }

  /** Following (paginated). */
  async* userFollowing(
    userId: string,
  ): AsyncGenerator<InstagramUser> {
    const params: Record<string, unknown> = { count: 12, max_id: null }
    yield* this._paginationFollowing(
      `/v1/friendships/${userId}/following/`,
      params,
    )
  }

  /** Internal — HTTP call */

  private async _call(
    endpoint: string,
    opts: {
      params?: Record<string, unknown>
      method?: string
      data?: Record<string, unknown>
    } = {},
  ): Promise<unknown> {
    const url = endpoint.startsWith('/')
      ? `https://www.instagram.com/api${endpoint}`
      : endpoint

    const csrf = this.getCsrf()
    const headers: Record<string, string> = {
      'Accept': '*/*',
      'Cookie': `csrftoken=${csrf}`,
      'X-CSRFToken': csrf,
      'X-IG-App-ID': APP_ID,
      'X-ASBD-ID': ASBD_ID,
      'X-IG-WWW-Claim': this.getWwwClaim(),
      'X-Requested-With': 'XMLHttpRequest',
      'Connection': 'keep-alive',
      'Referer': `${this.root}/`,
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
    }

    const resp: HttpResponse<unknown> = await this.http.request({
      url,
      method: opts.method ?? 'GET',
      headers,
      params: opts.params
        ? Object.fromEntries(
            Object.entries(opts.params).filter(
              ([, v]) => v != null,
            ) as [string, string][],
          )
        : undefined,
      data: opts.data,
    })

    // Check for login / challenge redirects (same logic as InstagramExtractor.request)
    const finalUrl = resp.url
    if (finalUrl.includes('/accounts/login/')) {
      throw new Error(
        'Instagram redirected to login page — you need a valid sessionid. '
        + 'Export it from your browser (F12 → Application → Cookies → sessionid) '
        + 'and pass --sessionid=<value> or set INSTAGRAM_SESSIONID env var.',
      )
    }
    if (finalUrl.includes('/challenge/')) {
      throw new Error(
        'Instagram redirected to challenge page — account flagged. '
        + 'Log in via browser to resolve the challenge, then export a fresh sessionid.',
      )
    }

    // Track CSRF updates
    const rawCookie = resp.headers['set-cookie']
    const cookieStr = Array.isArray(rawCookie) ? rawCookie.join('; ') : (rawCookie ?? '')
    const csrfCookie = cookieStr
      .split(';')
      .find(c => c.trim().startsWith('csrftoken='))
    if (csrfCookie) {
      const val = csrfCookie.split('=')[1]?.trim()
      if (val)
        this.setCsrf(val)
    }

    // Track www-claim
    const claim = resp.headers['x-ig-set-www-claim']
    if (claim != null) {
      this.setWwwClaim(String(claim))
    }

    return resp.data
  }

  /** Pagination engines */

  private async* _pagination(
    endpoint: string,
    params: Record<string, unknown> = {},
    media = false,
  ): AsyncGenerator<InstagramPost> {
    let maxId: string | null = this.getCursor()
    const reqParams = { ...params }

    while (true) {
      reqParams.max_id = maxId
      const data = (await this._call(endpoint, { params: reqParams })) as Record<string, unknown>

      if (data) {
        const items = data.items as Array<Record<string, unknown>> | undefined
        if (items) {
          for (const item of items) {
            if (media) {
              yield (item.media ?? item) as InstagramPost
            }
            else {
              yield item as unknown as InstagramPost
            }
          }
        }

        if (!data.more_available) {
          this.setCursor(null)
          return
        }
        maxId = this.setCursor(data.next_max_id as string | null)
      }
      else {
        this.setCursor(null)
        return
      }
    }
  }

  private async* _paginationPost(
    endpoint: string,
    reqData: Record<string, unknown>,
  ): AsyncGenerator<InstagramPost> {
    let maxId: string | null = this.getCursor()
    const data = { ...reqData }

    while (true) {
      data.max_id = maxId
      const resp = (await this._call(endpoint, {
        method: 'POST',
        data,
      })) as Record<string, unknown>

      if (resp) {
        const items = resp.items as Array<Record<string, unknown>> | undefined
        if (items) {
          for (const item of items) {
            yield (item.media ?? item) as InstagramPost
          }
        }

        const info = resp.paging_info as Record<string, unknown> | undefined
        if (!info || !info.more_available) {
          this.setCursor(null)
          return
        }
        maxId = this.setCursor(info.max_id as string | null)
      }
      else {
        this.setCursor(null)
        return
      }
    }
  }

  private async* _paginationSections(
    endpoint: string,
    reqData: Record<string, unknown>,
  ): AsyncGenerator<Record<string, unknown>> {
    let maxId: string | null = this.getCursor()
    let page: string | null = null
    const data = { ...reqData }

    while (true) {
      data.max_id = maxId
      data.page = page
      const info = (await this._call(endpoint, {
        method: 'POST',
        data,
      })) as Record<string, unknown>

      if (info) {
        const sections = info.sections as Record<string, unknown>[] | undefined
        if (sections) {
          yield* sections
        }

        if (!info.more_available) {
          this.setCursor(null)
          return
        }
        page = info.next_page as string | null
        maxId = this.setCursor(info.next_max_id as string | null)
      }
      else {
        this.setCursor(null)
        return
      }
    }
  }

  private async* _paginationFollowing(
    endpoint: string,
    params: Record<string, unknown>,
  ): AsyncGenerator<InstagramUser> {
    let maxId: string | number | null = this._parseIntCursor(
      this.getCursor() as string | null,
    )
    const reqParams = { ...params }

    while (true) {
      reqParams.max_id = maxId
      const data = (await this._call(endpoint, {
        params: reqParams as Record<string, unknown>,
      })) as Record<string, unknown>

      if (data) {
        const users = data.users as InstagramUser[] | undefined
        if (users) {
          yield* users
        }

        const nextMaxId = data.next_max_id
        if (nextMaxId == null) {
          this.setCursor(null)
          return
        }
        maxId = this._parseIntCursor(String(nextMaxId))
        this.setCursor(String(maxId))
      }
      else {
        this.setCursor(null)
        return
      }
    }
  }

  private _parseIntCursor(v: string | null): number | null {
    if (v == null || v === '')
      return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
}
