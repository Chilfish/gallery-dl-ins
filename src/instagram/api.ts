/**
 * Instagram REST API client.
 *
 * All endpoint methods return ``AsyncGenerator`` for paginated lists or
 * plain values for single-item endpoints.
 *
 * Instagram retired most of the web REST feed endpoints (``/v1/feed/user``,
 * ``/v1/clips/user``, ``/v1/usertags`` …). The primary data path is now the
 * Relay ``doc_id`` GraphQL endpoint; REST is kept as a fallback.
 */

import type { Logger } from '../core/extractor'
import type { HttpClient, HttpResponse, RequestConfig } from '../types'
import type {
  InstagramPost,
  InstagramUser,
} from './types'
import { idFromShortcode } from '../utils/id-codec'
import { extractMediaFromPage, extractUserTimelineFromPage } from './html-payload'

const APP_ID = '936619743392459'
const ASBD_ID = '129477'

const DEFAULT_USER_STRATEGIES = ['web', 'info']

/** GraphQL hosts, in fallback order. ``i.instagram.com`` is the reliable one. */
const GRAPHQL_HOSTS = [
  'https://i.instagram.com/api/graphql',
  'https://www.instagram.com/api/graphql',
]

/**
 * Relay operation ids. These rotate with Instagram's web build — refresh them
 * from the JS bundles (see docs/postmortem/008-rest-feed-deprecation.md).
 */
const DOC_IDS = {
  profile: '28036671149327607',
  posts: '27014165781614298',
  tagged: '29179217291735675',
  reels: '28280418711631396',
} as const

const PROVIDED_PROFILE = {
  __relay_internal__pv__PolarisCannesGuardianExperienceEnabledrelayprovider: true,
  __relay_internal__pv__PolarisCASB976ProfileEnabledrelayprovider: false,
  __relay_internal__pv__PolarisProfileInformTreatmentBannerEnabledrelayprovider: false,
  __relay_internal__pv__PolarisWebSchoolsEnabledrelayprovider: false,
  __relay_internal__pv__PolarisProfileRingsGradientEnabledrelayprovider: false,
  __relay_internal__pv__PolarisRepostsConsumptionEnabledrelayprovider: false,
  __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: false,
} as const

const PROVIDED_POSTS = {
  __relay_internal__pv__PolarisMultiCaptionCarouselEnabledrelayprovider: false,
  __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: false,
  __relay_internal__pv__PolarisSEOIsCrawlerrelayprovider: false,
  __relay_internal__pv__PolarisThreadsStyleCommentsEnabledrelayprovider: false,
  __relay_internal__pv__PolarisReelsRecoDebugOverlayEnabledrelayprovider: false,
} as const

const PROVIDED_TAGGED = {
  __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: false,
  __relay_internal__pv__PolarisSEOIsCrawlerrelayprovider: false,
} as const

const PROVIDED_REELS = {
  __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: false,
} as const

const DOCUMENT_HEADERS: Record<string, string> = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
}

type JsonRecord = Record<string, unknown>

/** Narrow an unknown value to a plain object (arrays excluded). */
function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value)
    ? value
    : []
}

function errorMessage(err: unknown): string {
  return err instanceof Error
    ? err.message
    : String(err)
}

/** Human-readable snippet of an HTML/JSON response body for error messages. */
function bodySummary(text: string, limit = 200): string {
  const collapsed = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!collapsed)
    return '(empty body)'
  return collapsed.length > limit
    ? `${collapsed.slice(0, limit)}…`
    : collapsed
}

/** Detect Instagram soft-rejection pages served with a 2xx status. */
function classifyShell(body: string): string | null {
  if (body.includes('not-logged-in'))
    return 'returned the logged-out page (not-logged-in) — sessionid is missing or expired'
  if (body.includes('challenge_required') || body.includes('/challenge/'))
    return 'requires a challenge — the account is flagged, resolve it in a browser first'
  if (body.includes('feedback_required'))
    return 'requires feedback — Instagram is rate-limiting this session'
  if (body.includes('/accounts/login/'))
    return 'redirected to the login page — sessionid is missing or expired'
  return null
}

/** Normalize a ``user-strategy`` config value into a list. */
export function normalizeUserStrategies(
  value: unknown,
): string[] {
  if (typeof value === 'string')
    return value.split(/[\s,]+/).filter(Boolean)
  if (Array.isArray(value))
    return value.filter((v): v is string => typeof v === 'string' && v.length > 0)
  return DEFAULT_USER_STRATEGIES
}

interface CallOptions {
  params?: Record<string, unknown>
  method?: string
  data?: Record<string, unknown>
  form?: Record<string, unknown>
  headers?: Record<string, string>
}

interface GraphqlPaginationOptions {
  docId: string
  friendlyName: string
  variables: (after: string | null) => JsonRecord
  connection: (data: JsonRecord) => JsonRecord | null
  node?: (edge: JsonRecord) => JsonRecord | null
}

export class InstagramRestAPI {
  private readonly http: HttpClient
  private readonly root: string
  private readonly request: (url: string, cfg?: RequestConfig) => Promise<HttpResponse<unknown>>
  private readonly getCsrf: () => string
  private readonly getWwwClaim: () => string
  private readonly setWwwClaim: (v: string) => void
  private readonly setCsrf: (v: string) => void
  private readonly getUserStrategies: () => string[]
  private readonly getApiBackend: () => string
  private readonly lsdToken: { value: string }
  private readonly log?: Logger

  /** A ref to the extractor's cursor. */
  private getCursor: () => string | null
  private setCursor: (v: string | null) => string | null

  constructor(opts: {
    http: HttpClient
    root: string
    csrfToken: { value: string }
    wwwClaim: { value: string }
    cursor: { value: string | null }
    /** Throttled request wrapper from the owning extractor. */
    request?: (url: string, cfg?: RequestConfig) => Promise<HttpResponse<unknown>>
    /** Shared ``lsd`` token used by the doc_id GraphQL endpoint. */
    lsdToken?: { value: string }
    userStrategies?: () => string[]
    apiBackend?: () => string
    log?: Logger
  }) {
    this.http = opts.http
    this.root = opts.root
    this.request = opts.request
      ?? ((url, cfg) => this.http.request({ url, ...cfg }))
    this.getUserStrategies = opts.userStrategies ?? (() => DEFAULT_USER_STRATEGIES)
    this.getApiBackend = opts.apiBackend ?? (() => 'auto')
    this.lsdToken = opts.lsdToken ?? { value: '' }
    this.log = opts.log

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
    const sc = shortcode.length > 28
      ? shortcode.slice(0, -28)
      : shortcode
    const numericId = idFromShortcode(sc)
    const endpoint = `/v1/media/${numericId}/info/`
    yield* this._pagination(endpoint)
  }

  /**
   * Media node embedded in a post page.
   *
   * The REST ``media/info`` endpoint returns a downscaled candidate list
   * (1080px and below) even though ``original_width`` describes the full
   * image. The post page ships the complete ladder — this reads it so callers
   * can upgrade the REST payload, and doubles as a fallback when REST refuses
   * (logged-out requests get a 404 ``not-logged-in``).
   */
  async pagePost(shortcode: string): Promise<InstagramPost | null> {
    const resp = await this._request({
      url: `${this.root}/p/${encodeURIComponent(shortcode)}/`,
      responseType: 'text',
      headers: DOCUMENT_HEADERS,
    })
    if (resp.status < 200 || resp.status >= 300)
      throw new Error(`post page returned status ${resp.status}`)

    const html = typeof resp.data === 'string'
      ? resp.data
      : ''
    const media = extractMediaFromPage(html)
    return media as unknown as InstagramPost | null
  }

  /**
   * Paginated user feed.
   *
   * GraphQL (doc_id) is the primary path because the REST endpoint has been
   * retired. ``username`` is required for the doc_id query; when omitted it is
   * resolved through ``userById``.
   */
  async* userFeed(userId: string, username?: string): AsyncGenerator<InstagramPost> {
    const errors: string[] = []
    const preferRest = this.getApiBackend() === 'rest'

    if (!username) {
      try {
        username = (await this.userById(userId)).username
      }
      catch (err) {
        errors.push(`username: ${errorMessage(err)}`)
      }
    }

    if (preferRest) {
      try {
        yield* this._pagination(`/v1/feed/user/${userId}/`, { count: 30 })
        return
      }
      catch (err) {
        errors.push(`REST: ${errorMessage(err)}`)
        this.log?.warn(`REST user feed failed for ${username ?? userId}: ${errorMessage(err)}`)
      }
    }

    if (username) {
      try {
        yield* this._graphqlUserPosts(username)
        return
      }
      catch (err) {
        errors.push(`GraphQL: ${errorMessage(err)}`)
        this.log?.warn(`GraphQL user feed failed for @${username}: ${errorMessage(err)}`)
      }
    }

    if (!preferRest) {
      try {
        yield* this._pagination(`/v1/feed/user/${userId}/`, { count: 30 })
        return
      }
      catch (err) {
        errors.push(`REST: ${errorMessage(err)}`)
        this.log?.warn(`REST user feed failed for @${username ?? userId}: ${errorMessage(err)}`)
      }
    }

    if (username) {
      try {
        const posts = await this._userTimelineFromPage(username)
        if (posts) {
          yield* posts
          return
        }
        errors.push('page payload: no embedded timeline')
      }
      catch (err) {
        errors.push(`page payload: ${errorMessage(err)}`)
      }
    }

    throw new Error(
      `User feed unavailable for ${username ?? userId}: ${errors.join('; ')}`,
    )
  }

  /** Paginated user reels. GraphQL (doc_id) first, REST POST fallback. */
  async* userClips(userId: string, username?: string): AsyncGenerator<InstagramPost> {
    const errors: string[] = []
    const preferRest = this.getApiBackend() === 'rest'

    if (!preferRest) {
      try {
        yield* this._graphqlUserClips(userId, username)
        return
      }
      catch (err) {
        errors.push(`GraphQL: ${errorMessage(err)}`)
        this.log?.warn(`GraphQL reels failed for ${userId}: ${errorMessage(err)}`)
      }
    }

    try {
      yield* this._paginationPost('/v1/clips/user/', {
        target_user_id: userId,
        page_size: '50',
        max_id: null,
        include_feed_video: 'true',
      })
      return
    }
    catch (err) {
      errors.push(`REST: ${errorMessage(err)}`)
    }

    if (preferRest) {
      try {
        yield* this._graphqlUserClips(userId, username)
        return
      }
      catch (err) {
        errors.push(`GraphQL: ${errorMessage(err)}`)
      }
    }

    throw new Error(`User reels unavailable for ${userId}: ${errors.join('; ')}`)
  }

  /** Paginated tagged posts. GraphQL (doc_id) first, REST fallback. */
  async* userTagged(userId: string): AsyncGenerator<InstagramPost> {
    const errors: string[] = []
    const preferRest = this.getApiBackend() === 'rest'

    if (!preferRest) {
      try {
        yield* this._graphqlUserTagged(userId)
        return
      }
      catch (err) {
        errors.push(`GraphQL: ${errorMessage(err)}`)
        this.log?.warn(`GraphQL tagged feed failed for ${userId}: ${errorMessage(err)}`)
      }
    }

    try {
      yield* this._pagination(`/v1/usertags/${userId}/feed/`, { count: 20 })
      return
    }
    catch (err) {
      errors.push(`REST: ${errorMessage(err)}`)
    }

    if (preferRest) {
      try {
        yield* this._graphqlUserTagged(userId)
        return
      }
      catch (err) {
        errors.push(`GraphQL: ${errorMessage(err)}`)
      }
    }

    throw new Error(`User tagged feed unavailable for ${userId}: ${errors.join('; ')}`)
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
    throw new Error('reels_media response contained no reels_media array')
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

  /**
   * User by numeric ID.
   *
   * GraphQL profile lookup first (REST ``/v1/users/{id}/info/`` is now
   * unreliable), with REST as a fallback.
   */
  async userById(userId: string): Promise<InstagramUser> {
    const errors: string[] = []
    const preferRest = this.getApiBackend() === 'rest'

    if (!preferRest) {
      try {
        return await this._graphqlUserProfile(userId)
      }
      catch (err) {
        errors.push(`GraphQL: ${errorMessage(err)}`)
      }
    }

    try {
      const data = await this._call(`/v1/users/${userId}/info/`)
      const user = (data as Record<string, unknown> | null)?.user
      if (user && typeof user === 'object')
        return user as InstagramUser
      throw new Error('response contained no user')
    }
    catch (err) {
      errors.push(`REST: ${errorMessage(err)}`)
    }

    if (preferRest) {
      try {
        return await this._graphqlUserProfile(userId)
      }
      catch (err) {
        errors.push(`GraphQL: ${errorMessage(err)}`)
      }
    }

    throw new Error(`userById failed for ${userId}: ${errors.join('; ')}`)
  }

  /** User by username (web_profile_info). */
  async userByName(username: string): Promise<InstagramUser> {
    const data = await this._call('/v1/users/web_profile_info/', {
      params: { username },
    })
    // Response shape: { data: { user: { ... } } }
    const inner = (data as Record<string, unknown> | null)?.data as Record<string, unknown> | undefined
    const user = inner?.user
    if (user && typeof user === 'object')
      return user as InstagramUser
    throw new Error(`userByName: web_profile_info returned no user for ${username}`)
  }

  /** Search user by username. */
  async userBySearch(username: string): Promise<InstagramUser> {
    const url = 'https://www.instagram.com/web/search/topsearch/'
    const data = await this._call(url, {
      params: { query: username },
    })
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
    throw new Error(`userBySearch: no match for ${username}`)
  }

  /** Scrape user ID from HTML profile page. */
  async userByWeb(username: string): Promise<{ id: string }> {
    const resp = await this._request({
      url: `https://www.instagram.com/${username}`,
      responseType: 'text',
      headers: DOCUMENT_HEADERS,
    })
    if (resp.status < 200 || resp.status >= 300)
      throw new Error(`userByWeb: profile page returned status ${resp.status}`)

    const text = typeof resp.data === 'string'
      ? resp.data
      : ''

    // Multiple page variants expose the id under different keys.
    const patterns = [
      /"page_id":"profilePage_(\d+)"/,
      /"profile_id":"(\d+)"/,
      /"props":\{"id":"(\d+)"/,
      /"user_id":"(\d+)"/,
    ]
    for (const pattern of patterns) {
      const match = pattern.exec(text)
      if (match?.[1])
        return { id: match[1] }
    }

    throw new Error(`userByWeb: no profile id in profile page for ${username}`)
  }

  /** Resolve screen name via a configurable fallback chain. */
  async userByScreenName(
    screenName: string,
    strategies: string[] = this.getUserStrategies(),
  ): Promise<InstagramUser> {
    const reasons: string[] = []

    for (const strategy of strategies) {
      try {
        if (strategy === 'search')
          return await this.userBySearch(screenName)
        if (strategy === 'info')
          return await this.userByName(screenName)
        if (strategy === 'web') {
          const result = await this.userByWeb(screenName)
          // The page only yields the numeric id — enrich through the GraphQL
          // profile query so avatar/info extractors get a full user object.
          try {
            const user = await this.userById(result.id)
            return {
              ...user,
              pk: user.pk ?? result.id,
              id: user.id ?? result.id,
            }
          }
          catch {
            return {
              pk: result.id,
              id: result.id,
              username: screenName,
              full_name: '',
            }
          }
        }
        reasons.push(`${strategy}: unknown strategy`)
      }
      catch (err) {
        reasons.push(`${strategy}: ${err instanceof Error
          ? err.message
          : String(err)}`)
      }
    }

    throw new Error(
      `User not found: ${screenName} (${reasons.join('; ') || 'no strategy configured'})`,
    )
  }

  /** Resolve username/id to numeric user ID string. */
  async userId(
    screenName: string,
    checkPrivate = true,
    strategies?: string[],
  ): Promise<string> {
    if (screenName.startsWith('id:')) {
      return screenName.slice(3)
    }
    const user = await this.userByScreenName(screenName, strategies)
    if (checkPrivate && user.is_private && !user.followed_by_viewer) {
      // warn, but proceed
    }
    return (user.id ?? user.pk) as string
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

  /** GraphQL user feed */

  private async* _graphqlUserPosts(username: string): AsyncGenerator<InstagramPost> {
    yield* this._graphqlPagination({
      docId: DOC_IDS.posts,
      friendlyName: 'PolarisProfilePostsQuery',
      variables: after => ({
        after,
        before: null,
        data: {
          count: 33,
          include_reel_media_seen_timestamp: true,
          include_relationship_info: true,
          latest_besties_reel_media: true,
          latest_reel_media: true,
        },
        username,
        ...PROVIDED_POSTS,
      }),
      connection: data => asRecord(data.xdt_api__v1__feed__user_timeline_graphql_connection),
    })
  }

  private async* _graphqlUserTagged(userId: string): AsyncGenerator<InstagramPost> {
    yield* this._graphqlPagination({
      docId: DOC_IDS.tagged,
      friendlyName: 'PolarisProfileTaggedTabContentQuery',
      variables: after => ({
        after,
        before: null,
        count: 30,
        first: null,
        last: null,
        user_id: userId,
        ...PROVIDED_TAGGED,
      }),
      connection: data => asRecord(data.xdt_api__v1__usertags__user_id__feed_connection),
    })
  }

  private async* _graphqlUserClips(userId: string, username?: string): AsyncGenerator<InstagramPost> {
    yield* this._graphqlPagination({
      docId: DOC_IDS.reels,
      friendlyName: 'PolarisProfileReelsTabContentQuery',
      variables: after => ({
        after,
        data: { count: 12 },
        first: 12,
        user_id: userId,
        ...PROVIDED_REELS,
      }),
      connection: (data) => {
        const user = asRecord(data.fetch__XDTUserDict)
        return asRecord(user?.clips_connection)
      },
      node: (edge) => {
        const media = asRecord(asRecord(edge.node)?.media)
        if (!media)
          return null
        // The reels query only selects ``user.pk`` — fill in the known
        // username so directory naming and metadata stay correct.
        const user = asRecord(media.user) ?? {}
        if (!user.pk)
          user.pk = userId
        if (username) {
          user.username = user.username ?? username
          user.full_name = user.full_name ?? ''
        }
        media.user = user
        return media
      },
    })
  }

  private async _graphqlUserProfile(userId: string): Promise<InstagramUser> {
    const data = await this._graphql(
      DOC_IDS.profile,
      'PolarisProfilePageContentQuery',
      {
        enable_integrity_filters: true,
        id: userId,
        render_surface: 'PROFILE',
        ...PROVIDED_PROFILE,
      },
    )
    const user = asRecord(data.user)
    if (!user)
      throw new Error(`GraphQL profile response contained no user for id ${userId}`)
    return user as unknown as InstagramUser
  }

  private async* _graphqlPagination(
    opts: GraphqlPaginationOptions,
  ): AsyncGenerator<InstagramPost> {
    let after: string | null = this.getCursor()
    let pages = 0

    while (true) {
      const data = await this._graphql(
        opts.docId,
        opts.friendlyName,
        opts.variables(after),
      )

      const connection = opts.connection(data)
      if (!connection)
        throw new Error(`${opts.friendlyName} response contained no connection`)

      const edges = asArray(connection.edges)
        .map(edge => asRecord(edge))
        .filter((edge): edge is JsonRecord => edge !== null)

      for (const edge of edges) {
        const node = opts.node
          ? opts.node(edge)
          : asRecord(edge.node)
        if (node)
          yield node as unknown as InstagramPost
      }

      const pageInfo = asRecord(connection.page_info)
      const next = typeof pageInfo?.end_cursor === 'string'
        ? pageInfo.end_cursor
        : null
      const hasNext = pageInfo?.has_next_page === true

      if (!hasNext || !next || next === after || ++pages > 200) {
        this.setCursor(null)
        return
      }
      after = this.setCursor(next)
    }
  }

  /** Acquire the ``lsd`` token required by the doc_id GraphQL endpoint. */
  private async _ensureLsd(): Promise<string> {
    if (this.lsdToken.value)
      return this.lsdToken.value

    const resp = await this._request({
      url: `${this.root}/`,
      responseType: 'text',
      headers: DOCUMENT_HEADERS,
    })
    if (resp.status < 200 || resp.status >= 300)
      throw new Error(`Could not load instagram.com for lsd token (status ${resp.status})`)

    const html = typeof resp.data === 'string'
      ? resp.data
      : ''
    const lsd = /"LSD",\[\],\{"token":"([^"]+)"/.exec(html)?.[1]
    if (!lsd) {
      throw new Error(
        'Could not extract the lsd token from instagram.com — '
        + 'sessionid may be missing/expired, or Instagram changed the page payload.',
      )
    }

    this.lsdToken.value = lsd
    return lsd
  }

  private async _graphql(
    docId: string,
    friendlyName: string,
    variables: JsonRecord,
  ): Promise<JsonRecord> {
    const lsd = await this._ensureLsd()
    const errors: string[] = []

    for (const host of GRAPHQL_HOSTS) {
      try {
        const payload = asRecord(await this._call(host, {
          method: 'POST',
          form: {
            doc_id: docId,
            variables: JSON.stringify(variables),
            lsd,
            server_timestamps: 'true',
            fb_api_caller_class: 'RelayModern',
            fb_api_req_friendly_name: friendlyName,
          },
          headers: {
            'X-FB-LSD': lsd,
            'X-FB-Friendly-Name': friendlyName,
          },
        }))

        if (!payload)
          throw new Error('empty GraphQL response')

        const gqlErrors = asArray(payload.errors)
          .map(err => asRecord(err))
          .filter((err): err is JsonRecord => err !== null)
        if (gqlErrors.length > 0) {
          const messages = gqlErrors
            .map(err => `${String(err.message ?? 'unknown error')}${err.code != null
              ? ` (code ${String(err.code)})`
              : ''}`)
          throw new Error(messages.join('; '))
        }

        const data = asRecord(payload.data)
        if (!data)
          throw new Error('GraphQL response contained no data')
        return data
      }
      catch (err) {
        errors.push(`${new URL(host).host}: ${errorMessage(err)}`)
      }
    }

    throw new Error(
      `GraphQL ${friendlyName} failed (${errors.join('; ')}) — doc_id may be outdated`,
    )
  }

  /** HTML page payload fallback for the user timeline. */
  private async _userTimelineFromPage(username: string): Promise<InstagramPost[] | null> {
    const resp = await this._request({
      url: `${this.root}/${encodeURIComponent(username)}/`,
      responseType: 'text',
      headers: DOCUMENT_HEADERS,
    })
    if (resp.status < 200 || resp.status >= 300)
      throw new Error(`profile page returned status ${resp.status}`)

    const html = typeof resp.data === 'string'
      ? resp.data
      : ''
    return extractUserTimelineFromPage(html)
  }

  /** Internal — HTTP call */

  private async _request(cfg: RequestConfig & { url: string }): Promise<HttpResponse<unknown>> {
    return this.request(cfg.url, cfg)
  }

  private async _call(
    endpoint: string,
    opts: CallOptions = {},
  ): Promise<unknown> {
    const url = endpoint.startsWith('/')
      ? `https://www.instagram.com/api${endpoint}`
      : endpoint

    const csrf = this.getCsrf()
    const headers: Record<string, string> = {
      'Accept': '*/*',
      'X-IG-App-ID': APP_ID,
      'X-ASBD-ID': ASBD_ID,
      'X-IG-WWW-Claim': this.getWwwClaim(),
      'X-Requested-With': 'XMLHttpRequest',
      'Connection': 'keep-alive',
      'Referer': `${this.root}/`,
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      ...opts.headers,
    }
    if (csrf) {
      headers.Cookie = `csrftoken=${csrf}`
      headers['X-CSRFToken'] = csrf
    }

    let data: unknown = opts.data
    if (opts.form) {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(opts.form)) {
        if (value != null)
          params.set(key, String(value))
      }
      data = params
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    }

    const resp = await this._request({
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
      data,
      responseType: 'text',
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

    // Decode the body ourselves so non-2xx / HTML responses keep their status
    // and a readable snippet instead of surfacing as a bare JSON SyntaxError.
    const raw = resp.data
    let dataOut: unknown = raw
    let parseFailed = false
    if (typeof raw === 'string') {
      try {
        dataOut = raw
          ? JSON.parse(raw)
          : null
      }
      catch {
        dataOut = null
        parseFailed = true
      }
    }

    if (parseFailed) {
      const body = typeof raw === 'string'
        ? raw
        : ''
      const shell = classifyShell(body)
      if (resp.status >= 200 && resp.status < 300) {
        throw new Error(
          `Instagram ${shell ?? 'returned a non-JSON response'} at ${url}: ${bodySummary(body)}`,
        )
      }
      throw new Error(
        `Instagram API error ${resp.status} at ${url}: ${bodySummary(body)}${
          shell
            ? ` (${shell})`
            : ''}`,
      )
    }

    if (resp.status < 200 || resp.status >= 300) {
      const body = typeof raw === 'string'
        ? bodySummary(raw)
        : bodySummary(JSON.stringify(raw))
      throw new Error(
        `Instagram API error ${resp.status} at ${url}: ${body}`,
      )
    }

    const payload = asRecord(dataOut)
    if (payload && payload.status === 'fail' && typeof payload.message === 'string') {
      throw new Error(
        `Instagram API error at ${url}: ${payload.message}${
          payload.status_code != null
            ? ` (status_code=${String(payload.status_code)})`
            : ''}`,
      )
    }

    // Track CSRF updates
    const rawCookie = resp.headers['set-cookie']
    const cookieStr = Array.isArray(rawCookie)
      ? rawCookie.join('; ')
      : (rawCookie ?? '')
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

    return dataOut
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

      if (!data) {
        this.setCursor(null)
        return
      }

      const items = this._itemsFromPayload(data)
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

      const next = this._nextCursor(data)
      if (!this._hasMore(data, next)) {
        this.setCursor(null)
        return
      }
      if (!next || next === maxId) {
        this.log?.debug(`Pagination stopped at ${endpoint}: no advancing cursor`)
        this.setCursor(null)
        return
      }
      maxId = this.setCursor(next)
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
        form: data,
      })) as Record<string, unknown>

      if (!resp) {
        this.setCursor(null)
        return
      }

      const items = this._itemsFromPayload(resp)
      if (items) {
        for (const item of items) {
          yield (item.media ?? item) as InstagramPost
        }
      }

      const info = asRecord(resp.paging_info)
      const next = info && typeof info.max_id === 'string'
        ? info.max_id
        : null
      if (!info || !info.more_available || !next || next === maxId) {
        this.setCursor(null)
        return
      }
      maxId = this.setCursor(next)
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
        form: data,
      })) as Record<string, unknown>

      if (!info) {
        this.setCursor(null)
        return
      }

      const sections = info.sections as Record<string, unknown>[] | undefined
      if (sections) {
        yield* sections
      }

      const nextPage = typeof info.next_page === 'string'
        ? info.next_page
        : null
      const nextMaxId = typeof info.next_max_id === 'string'
        ? info.next_max_id
        : null
      if (!info.more_available) {
        this.setCursor(null)
        return
      }
      if (nextPage === page && nextMaxId === maxId) {
        this.setCursor(null)
        return
      }
      page = nextPage
      maxId = this.setCursor(nextMaxId)
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

  private _itemsFromPayload(data: Record<string, unknown>): Record<string, unknown>[] | undefined {
    if (Array.isArray(data.items))
      return data.items as Record<string, unknown>[]

    if (Array.isArray(data.profile_grid_items))
      return data.profile_grid_items as Record<string, unknown>[]

    if (Array.isArray(data.edges)) {
      return (data.edges as unknown[])
        .map(edge => asRecord(asRecord(edge)?.node))
        .filter((node): node is JsonRecord => node !== null)
    }

    return undefined
  }

  private _nextCursor(data: Record<string, unknown>): string | null {
    const direct = data.next_max_id
    if (typeof direct === 'string' && direct.length > 0)
      return direct

    const pageInfo = asRecord(data.page_info)
    const end = pageInfo?.end_cursor
    return typeof end === 'string' && end.length > 0
      ? end
      : null
  }

  private _hasMore(data: Record<string, unknown>, next: string | null): boolean {
    if (typeof data.more_available === 'boolean')
      return data.more_available

    const pageInfo = asRecord(data.page_info)
    if (typeof pageInfo?.has_next_page === 'boolean')
      return pageInfo.has_next_page

    return next != null
  }

  private _parseIntCursor(v: string | null): number | null {
    if (v == null || v === '')
      return null
    const n = Number(v)
    return Number.isFinite(n)
      ? n
      : null
  }
}
