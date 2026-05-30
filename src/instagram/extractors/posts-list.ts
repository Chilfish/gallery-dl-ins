import type { InstagramExtractorOptions } from '../base'
import type { InstagramPost } from '../types'
import { InstagramExtractor } from '../base'
import { BASE_RE, re } from './helpers'
import { register } from './registry'

export class InstagramPostsExtractor extends InstagramExtractor {
  static readonly subcategory = 'posts'
  static override pattern = re(BASE_RE, /(\/[^/?#]+)\/posts/)

  override readonly subcategory = InstagramPostsExtractor.subcategory

  constructor(opts: InstagramExtractorOptions) {
    super(opts)
  }

  static fromURL(
    url: string,
    opts: InstagramExtractorOptions,
  ): InstagramPostsExtractor | null {
    const match = InstagramPostsExtractor.pattern.exec(url)
    if (!match)
      return null
    return new InstagramPostsExtractor({ ...opts, url, match })
  }

  override async* posts(): AsyncGenerator<InstagramPost> {
    const screenName = (this.groups[0] ?? '').replace(/^\//, '')
    const uid = await this.api.userId(screenName)
    yield* this.api.userFeed(uid)
  }
}

register(InstagramPostsExtractor.subcategory, InstagramPostsExtractor as unknown as import('../../types').ExtractorClass)
