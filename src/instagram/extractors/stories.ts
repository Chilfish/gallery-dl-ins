import type { InstagramExtractorOptions } from '../base'
import type { InstagramPost } from '../types'
import { InstagramExtractor } from '../base'
import { extractReelsMediaFromPage } from '../html-payload'
import { register } from './registry'

export class InstagramStoriesExtractor extends InstagramExtractor {
  static readonly subcategory = 'stories'
  static override pattern
    = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:stories\/(?:highlights\/(\d+)|([^/?#]+)(?:\/(\d+))?)|\/(aGlnaGxpZ2h0[^?#]+)(?:\?story_media_id=(\d+))?)/

  override readonly subcategory = InstagramStoriesExtractor.subcategory
  private highlightId: string | null = null
  private mediaId: string | null = null

  constructor(opts: InstagramExtractorOptions) {
    super(opts)
    const groups = this.groups as string[]
    const h1 = groups[0]
    const user = groups[1]
    const m1 = groups[2]
    const h2 = groups[3]
    const m2 = groups[4]

    if (user) {
      (this as { subcategory: string }).subcategory = 'stories'
      this.highlightId = null
    }
    else {
      (this as { subcategory: string }).subcategory = 'highlights'
      this.highlightId = h1
        ? `highlight:${h1}`
        : `highlight:${Buffer.from(h2 ?? '', 'base64').toString('utf-8')}`
    }

    this.mediaId = m1 ?? m2 ?? null
  }

  static fromURL(
    url: string,
    opts: InstagramExtractorOptions,
  ): InstagramStoriesExtractor | null {
    const match = InstagramStoriesExtractor.pattern.exec(url)
    if (!match)
      return null
    return new InstagramStoriesExtractor({ ...opts, url, match })
  }

  /**
   * Read the reel payload embedded in the story / highlight page.
   *
   * Instagram server-renders both routes with a ``data-sjs`` payload. The REST
   * ``reels_media`` endpoint is unreliable for web sessions, so the page is
   * tried first for user stories and direct highlight links alike.
   *
   * Returns ``null`` when the page has no usable payload so the caller can
   * fall back to the REST endpoint.
   */
  private async _reelsFromPage(): Promise<InstagramPost[] | null> {
    const highlightId = this.highlightId
    const username = this.groups[1]
    const pagePath = highlightId
      ? `/stories/highlights/${highlightId.slice('highlight:'.length)}/`
      : username
        ? `/stories/${encodeURIComponent(username)}/`
        : null

    if (!pagePath)
      return null

    try {
      const resp = await this.request(
        `${this.root}${pagePath}`,
        {
          responseType: 'text',
          // Without document-navigation headers Instagram serves a JS shell
          // with no embedded reel payload.
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1',
          },
        },
      )
      if (resp.status < 200 || resp.status >= 300) {
        this.log.debug(`reel page returned status ${resp.status} — falling back to reels_media`)
        return null
      }

      const html = typeof resp.data === 'string'
        ? resp.data
        : ''
      const reels = extractReelsMediaFromPage(html)
      if (!reels) {
        this.log.debug('reel page had no embedded payload — falling back to reels_media')
        return null
      }

      for (const reel of reels) {
        if (!reel.user && username) {
          reel.user = {
            pk: String(reel.id ?? reel.pk ?? ''),
            username,
            full_name: '',
          }
        }
        // User stories: the page payload omits reel-level expiring_at; derive
        // it from items or the parser classifies the reel as a highlight.
        // Highlights must stay without expiring_at (that is their type marker).
        if (!highlightId && reel.expiring_at == null) {
          const latest = (reel.items ?? []).reduce(
            (max, item) => Math.max(max, item.expiring_at ?? 0),
            0,
          )
          if (latest > 0)
            reel.expiring_at = latest
        }
      }
      return reels
    }
    catch (err) {
      this.log.debug(
        `reel page payload unavailable (${err instanceof Error
          ? err.message
          : String(err)}) — falling back to reels_media`,
      )
      return null
    }
  }

  override async* posts(): AsyncGenerator<InstagramPost> {
    let reels: InstagramPost[] | null = await this._reelsFromPage()

    if (!reels) {
      const reelId = this.highlightId
        ? this.highlightId
        : await this.api.userId((this.groups[1] ?? '').toString())
      reels = await this.api.reelsMedia([reelId])
    }

    if (!reels.length)
      return

    if (this.mediaId) {
      const reel = reels[0]!
      const item = (reel.items ?? []).find(i => i.pk === this.mediaId)
      if (!item) {
        this.log.warn(`Story ${this.mediaId} not found in reel — it may have expired`)
        return
      }
      reel.items = [item]
      yield reel
      return
    }

    const split = this._cfg('split', false) as boolean
    if (split) {
      const reel = reels[0]!
      for (const item of reel.items ?? []) {
        const copy = { ...reel }
        copy.items = [item]
        yield copy
      }
    }
    else {
      yield* reels
    }
  }
}

register(InstagramStoriesExtractor.subcategory, InstagramStoriesExtractor as unknown as import('../../types').ExtractorClass)
