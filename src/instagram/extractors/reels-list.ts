import type { InstagramExtractorOptions } from '../base'
import type { InstagramPost } from '../types'
import { InstagramExtractor } from '../base'
import { BASE_RE, re } from './helpers'
import { register } from './registry'

export class InstagramReelsExtractor extends InstagramExtractor {
  static readonly subcategory = 'reels'
  static override pattern = re(BASE_RE, /(\/[^/?#]+)\/reels/)

  override readonly subcategory = InstagramReelsExtractor.subcategory

  constructor(opts: InstagramExtractorOptions) {
    super(opts)
  }

  static fromURL(
    url: string,
    opts: InstagramExtractorOptions,
  ): InstagramReelsExtractor | null {
    const match = InstagramReelsExtractor.pattern.exec(url)
    if (!match) return null
    return new InstagramReelsExtractor({ ...opts, url, match })
  }

  override async* posts(): AsyncGenerator<InstagramPost> {
    const screenName = (this.groups[0] ?? '').replace(/^\//, '')
    const uid = await this.api.userId(screenName)
    yield* this.api.userClips(uid)
  }
}

register(InstagramReelsExtractor.subcategory, InstagramReelsExtractor as unknown as import('../../types').ExtractorClass)
