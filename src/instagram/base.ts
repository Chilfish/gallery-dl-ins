/**
 * InstagramExtractor — base class shared by all Instagram sub-extractors.
 */

import type { ExtractorOptions } from '../core/extractor'
import type {
  HttpResponse,
  MessageIter,
  Metadata,
  RequestConfig,
} from '../types'
import type {
  InstagramPost,
  InstagramUser,
  ParsedPost,
  ParserConfig,
} from './types'
import { Extractor } from '../core/extractor'
import { url } from '../message'
import { findTags, nameExtFromURL } from '../utils/text'
import { InstagramRestAPI, normalizeUserStrategies } from './api'
import { needsUpgrade, upgradeMedia } from './media-upgrade'
import { parsePostGraphql, parsePostRest } from './parsers'

export class Ref<T> {
  value: T
  constructor(v: T) {
    this.value = v
  }
}

/** Refs shared between a parent extractor and its queue children. */
export interface InstagramExtractorState {
  csrfToken?: Ref<string>
  wwwClaim?: Ref<string>
  lsdToken?: Ref<string>
}

export interface InstagramExtractorOptions extends ExtractorOptions {
  sessionId?: string
  cookies?: Record<string, string>
  /** Pre-seeded CSRF token (from anonymous session cookie jar). */
  csrfToken?: string
  /** Pre-seeded GraphQL ``lsd`` token (shared across queue children). */
  lsdToken?: string
  /** Shared refs so queue children reuse the parent's session tokens. */
  state?: InstagramExtractorState
}

export abstract class InstagramExtractor extends Extractor {
  override readonly category = 'instagram'
  override readonly root = 'https://www.instagram.com'

  api!: InstagramRestAPI
  csrfToken: Ref<string> = new Ref('')
  wwwClaim: Ref<string> = new Ref('0')
  lsdToken: Ref<string> = new Ref('')
  cursor: Ref<string | null> = new Ref(null)

  protected _loggedIn = true
  protected _user: InstagramUser | null = null

  private readonly _findTags = findTags
  private readonly _csrfSeed: string | undefined
  private readonly _lsdSeed: string | undefined

  constructor(opts: InstagramExtractorOptions) {
    super(opts)
    this._csrfSeed = opts.csrfToken
    this._lsdSeed = opts.lsdToken

    if (opts.state?.csrfToken)
      this.csrfToken = opts.state.csrfToken
    if (opts.state?.wwwClaim)
      this.wwwClaim = opts.state.wwwClaim
    if (opts.state?.lsdToken)
      this.lsdToken = opts.state.lsdToken
  }

  /** Initialization */

  protected override async _init(): Promise<void> {
    // Reuse the session token from a parent extractor, else a pre-seeded one,
    // else generate a random token for sessionid-based auth.
    if (!this.csrfToken.value)
      this.csrfToken.value = this._csrfSeed || Extractor.generateToken(16)
    if (!this.lsdToken.value)
      this.lsdToken.value = this._lsdSeed ?? ''

    this.api = new InstagramRestAPI({
      http: this.http,
      root: this.root,
      csrfToken: this.csrfToken,
      wwwClaim: this.wwwClaim,
      lsdToken: this.lsdToken,
      cursor: this.cursor,
      request: (url, cfg) => this.request(url, cfg),
      apiBackend: () => String(this._cfg('api', 'auto')),
      userStrategies: () => normalizeUserStrategies(
        this._cfg('user-strategy', ['web', 'info']),
      ),
      log: this.log,
    })
  }

  /** Request override */

  override async request(
    url: string,
    cfg: RequestConfig = {},
  ): Promise<HttpResponse<unknown>> {
    const response = await super.request(url, cfg)

    const finalUrl = response.url
    if (finalUrl.includes('/accounts/login/')) {
      throw new Error(
        'HTTP redirect to login page — cookies expired or invalid',
      )
    }
    if (finalUrl.includes('/challenge/')) {
      throw new Error(
        'HTTP redirect to challenge page — account flagged',
      )
    }

    const claim = response.headers['x-ig-set-www-claim']
    if (claim != null) {
      this.wwwClaim.value = String(claim)
    }

    return response
  }

  /** Login */

  async login(): Promise<void> {
    this._loggedIn = true
  }

  /** Core pipeline */

  override async* items(): MessageIter {
    await this.login()

    const meta = (await this.metadata()) ?? {}

    const videos = this._cfg('videos', true) as string | boolean
    const videosDash = videos !== 'merged'
    const shouldDownloadVideos = !!videos

    const previews = this._cfg('previews', false) as
      | string
      | boolean
      | string[]
    const previewsVid
      = typeof previews === 'object'
        ? previews.includes('video')
        : false
    const previewsAud
      = typeof previews === 'object'
        ? previews.includes('audio')
        : false

    const audio = this._cfg('audio', false) as boolean
    const maxPosts = this._cfg('max-posts') as number | undefined
    const orderFiles = this._cfg('order-files') as string | undefined
    const reverse = orderFiles
      ? (['r', 'd'] as readonly string[]).includes(orderFiles[0]!)
      : false

    const parserCfg: ParserConfig = {
      root: this.root,
      findTags: this._findTags,
      parseTimestamp: this.parseTimestamp.bind(this),
      staticVideo: (this._cfg('static-videos', true) ?? true) as boolean,
      warnVideo: !previews && shouldDownloadVideos,
      warnImage: 1,
      videosDash,
    }

    this.log.debug(
      `cfg: videos=${shouldDownloadVideos} previews=${!!previews} audio=${audio} maxPosts=${maxPosts ?? '∞'} staticVideos=${parserCfg.staticVideo}`,
    )

    // REST ``media/info`` serves a downscaled candidate ladder; the post page
    // carries the full-size one. Fetch it only when the payload was trimmed.
    const restoreOriginal = this._cfg('original', true) !== false

    let count = 0
    for await (const post of this.posts()) {
      if (maxPosts != null && count >= maxPosts)
        break
      count++

      if (restoreOriginal && post.code && needsUpgrade(post)) {
        try {
          const page = await this.api.pagePost(post.code)
          if (upgradeMedia(post, page))
            this.log.debug(`Restored original-size media for ${post.code}`)
        }
        catch (err) {
          this.log.debug(
            `Post page upgrade skipped for ${post.code}: ${err instanceof Error
              ? err.message
              : String(err)}`,
          )
        }
      }

      // Route by shape, not by ``__typename``: doc_id GraphQL media nodes carry
      // ``__typename`` but keep the REST shape (``user`` + ``image_versions2``).
      const postRec = post as unknown as Record<string, unknown>
      const isRestShape
        = post.items != null
          || (postRec.image_versions2 != null && postRec.user != null)
      const parsed: ParsedPost = isRestShape
        ? parsePostRest(post, parserCfg)
        : parsePostGraphql(postRec, parserCfg)

      if (this._user) {
        (parsed as unknown as Record<string, unknown>).user = this._user
      }
      Object.assign(parsed, meta)

      const files = parsed._files
      parsed.count = files.length

      yield { type: 'directory', metadata: parsed as unknown as Metadata }

      const ordered = reverse
        ? [...files].reverse()
        : files
      for (const file of ordered) {
        const combined: Record<string, unknown> = {
          ...parsed,
          ...file,
        }

        if (file.audio_url) {
          if (audio) {
            nameExtFromURL(file.audio_url, combined)
            yield url(file.audio_url, combined as unknown as Metadata)
          }
          if (previewsAud) {
            combined.media_id = `${combined.media_id as string}p`
          }

          // Always yield the cover art so BGM metadata (title, artist, etc.)
          // is visible in --info even without --audio. Only skip if this
          // is a pure audio file with no cover art to show.
          if (!audio && !previewsAud) {
            const coverUrl = file.display_url
            if (coverUrl) {
              nameExtFromURL(coverUrl, combined)
              yield url(coverUrl, combined as unknown as Metadata)
            }
            continue
          }
        }

        if (file.video_url) {
          if (shouldDownloadVideos) {
            nameExtFromURL(file.video_url, combined)
            yield url(file.video_url, combined as unknown as Metadata)
          }
          if (previewsVid) {
            combined.media_id = `${combined.media_id as string}p`
          }
          else {
            continue
          }
        }

        const imgUrl = file.display_url
        nameExtFromURL(imgUrl, combined)
        if (
          combined.extension === 'webp'
          && imgUrl.includes('stp=dst-jpg')
        ) {
          combined.extension = 'jpg'
        }
        yield url(imgUrl, combined as unknown as Metadata)
      }
    }

    if (count === 0) {
      this.log.warn('No posts returned — API may have returned empty data (check sessionid or post visibility)')
    }
  }

  /** Subclass hooks */

  /** @virtual */
  async metadata(): Promise<Record<string, unknown>> {
    return {}
  }

  abstract posts(): AsyncGenerator<InstagramPost>

  /** Cursor management */

  protected _initCursor(): string | null {
    const cursor = this._cfg('cursor', true)
    if (cursor === true)
      return null
    if (!cursor)
      return null
    return cursor as string | null
  }

  protected _updateCursor(cursor: string | null): string | null {
    if (cursor) {
      this.log.debug(`Cursor: ${cursor}`)
    }
    this.cursor.value = cursor
    return cursor
  }

  /** User assignment */

  protected _assignUser(user: InstagramUser): void {
    this._user = user

    const mappings: Array<[string, string]> = [
      ['count_media', 'edge_owner_to_timeline_media'],
      ['count_video', 'edge_felix_video_timeline'],
      ['count_saved', 'edge_saved_media'],
      ['count_mutual', 'edge_mutual_followed_by'],
      ['count_follow', 'edge_follow'],
      ['count_followed', 'edge_followed_by'],
      ['count_collection', 'edge_media_collections'],
    ]

    const rec = user as unknown as Record<string, unknown>
    for (const [newKey, oldKey] of mappings) {
      try {
        const edge = rec[oldKey] as { count: number } | undefined
        rec[newKey] = edge?.count ?? 0
        delete rec[oldKey]
      }
      catch {
        rec[newKey] = 0
      }
    }
  }
}
