import type { InstagramExtractorOptions } from '../base'
import type { InstagramPost, InstagramUser } from '../types'
import { shortcodeFromId } from '../../utils/id-codec'
import { InstagramExtractor } from '../base'
import { BASE_RE, re } from './helpers'
import { register } from './registry'

export class InstagramAvatarExtractor extends InstagramExtractor {
  static readonly subcategory = 'avatar'
  static override pattern = re(BASE_RE, /(\/[^/?#]+)\/avatar/)

  override readonly subcategory = InstagramAvatarExtractor.subcategory

  constructor(opts: InstagramExtractorOptions) {
    super(opts)
  }

  static fromURL(
    url: string,
    opts: InstagramExtractorOptions,
  ): InstagramAvatarExtractor | null {
    const match = InstagramAvatarExtractor.pattern.exec(url)
    if (!match) return null
    return new InstagramAvatarExtractor({ ...opts, url, match })
  }

  override async* posts(): AsyncGenerator<InstagramPost> {
    const screenName = (this.groups[0] ?? '').replace(/^\//, '')
    let user: InstagramUser

    if (screenName.startsWith('id:')) {
      user = await this.api.userById(screenName.slice(3))
    }
    else {
      user = await this.api.userByScreenName(screenName)
    }

    const avatar
      = user.hd_profile_pic_url_info
        ?? user.hd_profile_pic_versions?.[user.hd_profile_pic_versions.length - 1]
        ?? { url: user.profile_pic_url ?? '', width: 0, height: 0 }

    let pk = user.profile_pic_id?.split('_')[0]
    let code: string

    if (pk) {
      code = shortcodeFromId(pk)
    }
    else {
      pk = `avatar:${user.pk}`
      code = pk
    }

    yield {
      pk,
      code,
      user,
      caption: null,
      like_count: 0,
      image_versions2: { candidates: [avatar] },
    } as unknown as InstagramPost
  }
}

register(InstagramAvatarExtractor.subcategory, InstagramAvatarExtractor as unknown as import('../../types').ExtractorClass)
