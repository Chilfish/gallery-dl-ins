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

    try {
      const posts: InstagramPost[] = []
      for await (const post of this.api.media(shortcode))
        posts.push(post)
      if (posts.length > 0) {
        yield* posts
        return
      }
      this.log.debug(`REST returned no media for ${shortcode} — falling back to the post page`)
    }
    catch (err) {
      this.log.debug(
        `REST media failed for ${shortcode} (${err instanceof Error
          ? err.message
          : String(err)}) — falling back to the post page`,
      )
    }

    const page = await this.api.pagePost(shortcode)
    if (!page) {
      throw new Error(
        `Could not read post ${shortcode} from REST or its page `
        + '— it may be private, deleted, or age-restricted',
      )
    }
    yield page
  }
}

register(InstagramPostExtractor.subcategory, InstagramPostExtractor as unknown as import('../../types').ExtractorClass)
