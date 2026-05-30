import type { InstagramExtractorOptions } from '../base'
import type { InstagramPost } from '../types'
import { ensureHttpScheme } from '../../utils/text'
import { InstagramExtractor } from '../base'
import { re } from './helpers'
import { register } from './registry'

export class InstagramPostExtractor extends InstagramExtractor {
  static readonly subcategory = 'post'
  static override pattern = re(
    /^(?:https?:\/\/)?(?:www\.)?instagram\.com\//,
    /(?:share(?:\/(?:p|tv|reels?))?|(?:[^/?#]+\/)?(?:p|tv|reels?))\/([^/?#]+)/,
  )

  override readonly subcategory = InstagramPostExtractor.subcategory

  constructor(opts: InstagramExtractorOptions) {
    super(opts)
    if (opts.match[2] != null || opts.match[3] != null) {
      (this as { subcategory: string }).subcategory = 'reel'
    }
  }

  static fromURL(
    url: string,
    opts: InstagramExtractorOptions,
  ): InstagramPostExtractor | null {
    const match = InstagramPostExtractor.pattern.exec(url)
    if (!match)
      return null
    return new InstagramPostExtractor({ ...opts, url, match })
  }

  override async* posts(): AsyncGenerator<InstagramPost> {
    const groups = this.groups as string[]
    let shortcode: string | undefined = groups[0]
    if (!shortcode)
      return

    if (groups[1] === '') {
      this.log.info(`Resolving share link: ${this.url}`)
      const resp = await this.request(ensureHttpScheme(this.url), {
        headers: {
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'same-origin',
        },
      })
      const parts = (resp as { url?: string }).url?.split('/')
      shortcode = parts?.[parts.length - 2] ?? shortcode
    }

    this.log.debug(`Fetching post: ${shortcode}`)
    yield* this.api.media(shortcode)
  }
}

register(InstagramPostExtractor.subcategory, InstagramPostExtractor as unknown as import('../../types').ExtractorClass)
