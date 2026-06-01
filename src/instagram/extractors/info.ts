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

    // userById returns richer data (follower_count, biography, external_url)
    // than userByScreenName (search / web_profile_info).
    const userId = screenName.startsWith('id:')
      ? screenName.slice(3)
      : await this.api.userId(screenName, false)
    const user: InstagramUser = await this.api.userById(userId)

    const ur = user as unknown as Record<string, unknown>
    const num = (key: string): number =>
      (ur[key] as number) ?? (ur[key] as { count?: number } | undefined)?.count ?? 0

    yield directory({
      post_id: user.pk,
      post_shortcode: user.username,
      post_url: `${this.root}/${user.username}/`,
      owner_id: user.pk,
      username: user.username,
      fullname: user.full_name ?? '',
      post_date: '',
      date: '',
      description: '',
      likes: 0,
      liked: false,
      pinned: [],
      type: 'post',
      count: 0,
      _files: [],
      user,
      // Extra profile fields (from /v1/users/{id}/info/)
      is_private: user.is_private ?? false,
      is_verified: user.is_verified ?? false,
      profile_pic_url: user.profile_pic_url ?? '',
      profile_pic_url_hd: user.hd_profile_pic_url_info?.url ?? user.profile_pic_url_hd ?? '',
      follower_count: num('follower_count'),
      following_count: num('following_count'),
      media_count: num('media_count'),
      biography: (ur.biography ?? '') as string,
      external_url: (ur.external_url ?? '') as string,
    } as Metadata)
  }

  override async* posts(): AsyncGenerator<InstagramPost> {}
}

register(InstagramInfoExtractor.subcategory, InstagramInfoExtractor as unknown as import('../../types').ExtractorClass)
