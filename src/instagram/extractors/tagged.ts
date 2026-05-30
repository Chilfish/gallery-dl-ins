import type { InstagramExtractorOptions } from '../base'
import type { InstagramPost, InstagramUser } from '../types'
import { InstagramExtractor } from '../base'
import { BASE_RE, re } from './helpers'
import { register } from './registry'

export class InstagramTaggedExtractor extends InstagramExtractor {
  static readonly subcategory = 'tagged'
  static override pattern = re(BASE_RE, /(\/[^/?#]+)\/tagged/)

  override readonly subcategory = InstagramTaggedExtractor.subcategory
  private _taggedUserId = ''

  constructor(opts: InstagramExtractorOptions) {
    super(opts)
  }

  static fromURL(
    url: string,
    opts: InstagramExtractorOptions,
  ): InstagramTaggedExtractor | null {
    const match = InstagramTaggedExtractor.pattern.exec(url)
    if (!match)
      return null
    return new InstagramTaggedExtractor({ ...opts, url, match })
  }

  override async metadata(): Promise<Record<string, unknown>> {
    const screenName = (this.groups[0] ?? '').replace(/^\//, '')
    let user: InstagramUser

    if (screenName.startsWith('id:')) {
      this._taggedUserId = screenName.slice(3)
      user = await this.api.userById(screenName.slice(3))
    }
    else {
      this._taggedUserId = await this.api.userId(screenName)
      user = await this.api.userByScreenName(screenName)
    }

    return {
      tagged_owner_id: user.id ?? user.pk,
      tagged_username: user.username,
      tagged_full_name: user.full_name,
    }
  }

  override async* posts(): AsyncGenerator<InstagramPost> {
    if (!this._taggedUserId)
      await this.metadata()
    yield* this.api.userTagged(this._taggedUserId)
  }
}

register(InstagramTaggedExtractor.subcategory, InstagramTaggedExtractor as unknown as import('../../types').ExtractorClass)
