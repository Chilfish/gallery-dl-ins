import type { InstagramExtractorOptions } from '../base'
import type { InstagramPost } from '../types'
import { InstagramExtractor } from '../base'
import { BASE_RE, re } from './helpers'
import { register } from './registry'

export class InstagramSavedExtractor extends InstagramExtractor {
  static readonly subcategory = 'saved'
  static override pattern = re(BASE_RE, /(\/[^/?#]+)\/saved(?:\/all-posts)?\/?$/)

  override readonly subcategory = InstagramSavedExtractor.subcategory

  constructor(opts: InstagramExtractorOptions) {
    super(opts)
  }

  static fromURL(
    url: string,
    opts: InstagramExtractorOptions,
  ): InstagramSavedExtractor | null {
    const match = InstagramSavedExtractor.pattern.exec(url)
    if (!match)
      return null
    return new InstagramSavedExtractor({ ...opts, url, match })
  }

  override async* posts(): AsyncGenerator<InstagramPost> {
    yield* this.api.userSaved()
  }
}

register(InstagramSavedExtractor.subcategory, InstagramSavedExtractor as unknown as import('../../types').ExtractorClass)
