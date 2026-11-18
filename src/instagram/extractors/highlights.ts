import type { InstagramExtractorOptions } from '../base'
import type { InstagramPost } from '../types'
import { InstagramExtractor } from '../base'
import { BASE_RE, re } from './helpers'
import { register } from './registry'

export class InstagramHighlightsExtractor extends InstagramExtractor {
  static readonly subcategory = 'highlights'
  static override pattern = re(BASE_RE, /(\/(?!stories(?:\/|$))[^/?#]+)\/highlights/)

  override readonly subcategory = InstagramHighlightsExtractor.subcategory

  constructor(opts: InstagramExtractorOptions) {
    super(opts)
  }

  static fromURL(
    url: string,
    opts: InstagramExtractorOptions,
  ): InstagramHighlightsExtractor | null {
    const match = InstagramHighlightsExtractor.pattern.exec(url)
    if (!match)
      return null
    return new InstagramHighlightsExtractor({ ...opts, url, match })
  }

  override async* posts(): AsyncGenerator<InstagramPost> {
    const screenName = (this.groups[0] ?? '').replace(/^\//, '')
    const uid = await this.api.userId(screenName)
    yield* this.api.highlightsMedia(uid)
  }
}

register(InstagramHighlightsExtractor.subcategory, InstagramHighlightsExtractor as unknown as import('../../types').ExtractorClass)
