import type { MessageIter, Metadata } from '../../types'
import type { InstagramExtractorOptions } from '../base'
import type { InstagramPost, InstagramUser } from '../types'
import { directory } from '../../message'
import { InstagramExtractor } from '../base'
import { BASE_RE, re } from './helpers'
import { register } from './registry'

export class InstagramInfoExtractor extends InstagramExtractor {
  static readonly subcategory = 'info'
  static override pattern = re(BASE_RE, /(\/[^/?#]+)\/info/)

  override readonly subcategory = InstagramInfoExtractor.subcategory

  constructor(opts: InstagramExtractorOptions) {
    super(opts)
  }

  static fromURL(
    url: string,
    opts: InstagramExtractorOptions,
  ): InstagramInfoExtractor | null {
    const match = InstagramInfoExtractor.pattern.exec(url)
    if (!match)
      return null
    return new InstagramInfoExtractor({ ...opts, url, match })
  }

  override async* items(): MessageIter {
    const screenName = (this.groups[0] ?? '').replace(/^\//, '')
    let user: InstagramUser

    if (screenName.startsWith('id:')) {
      user = await this.api.userById(screenName.slice(3))
    }
    else {
      user = await this.api.userByScreenName(screenName)
    }

    yield directory(user as unknown as Metadata)
  }

  override async* posts(): AsyncGenerator<InstagramPost> {}
}

register(InstagramInfoExtractor.subcategory, InstagramInfoExtractor as unknown as import('../../types').ExtractorClass)
