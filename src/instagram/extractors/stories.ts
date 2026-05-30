import type { InstagramExtractorOptions } from '../base'
import type { InstagramPost } from '../types'
import { InstagramExtractor } from '../base'
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
    if (!match) return null
    return new InstagramStoriesExtractor({ ...opts, url, match })
  }

  override async* posts(): AsyncGenerator<InstagramPost> {
    const reelId = this.highlightId
      ? this.highlightId
      : await this.api.userId((this.groups[1] ?? '').toString())

    const reels = await this.api.reelsMedia([reelId])
    if (!reels.length) return

    if (this.mediaId) {
      const reel = reels[0]!
      for (const item of reel.items ?? []) {
        if (item.pk === this.mediaId) {
          reel.items = [item]
          break
        }
      }
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
