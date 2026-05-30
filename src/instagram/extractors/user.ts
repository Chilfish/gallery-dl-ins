import type { MessageIter } from '../../types'
import type { InstagramExtractorOptions } from '../base'
import type { InstagramPost } from '../types'
import { queue } from '../../message'
import { InstagramExtractor } from '../base'
import { BASE_RE, re } from './helpers'
import { get } from './registry'
import { register } from './registry'

export class InstagramUserExtractor extends InstagramExtractor {
  static readonly subcategory = 'user'
  static override pattern = re(BASE_RE, /(\/[^/?#]+)\/?(?:$|[?#])/)

  override readonly subcategory = InstagramUserExtractor.subcategory

  constructor(opts: InstagramExtractorOptions) {
    super(opts)
  }

  static fromURL(
    url: string,
    opts: InstagramExtractorOptions,
  ): InstagramUserExtractor | null {
    const match = InstagramUserExtractor.pattern.exec(url)
    if (!match) return null
    return new InstagramUserExtractor({ ...opts, url, match })
  }

  override async* items(): MessageIter {
    await this.login()

    const userPath = this.groups[0] ?? '/'
    const base = `${this.root}${userPath}/`
    const storiesUrl = `${this.root}/stories/${userPath.slice(1)}/`

    const include = this._cfg('include', ['posts']) as string[] | string
    const categories: string[]
      = include === 'all'
        ? ['posts', 'reels', 'tagged', 'stories', 'highlights', 'info', 'avatar']
        : typeof include === 'string'
          ? include.replace(/\s+/g, '').split(',')
          : include

    const urls: Record<string, string> = {
      info: `${base}info/`,
      avatar: `${base}avatar/`,
      stories: storiesUrl,
      highlights: `${base}highlights/`,
      posts: `${base}posts/`,
      reels: `${base}reels/`,
      tagged: `${base}tagged/`,
    }

    for (const cat of categories) {
      const cls = get(cat)
      const url = urls[cat]
      if (cls && url) {
        yield queue(url, { _extractor: cls })
      }
      else {
        this.log.warn(`Invalid include '${cat}'`)
      }
    }
  }

  override async* posts(): AsyncGenerator<InstagramPost> {}
}

register(InstagramUserExtractor.subcategory, InstagramUserExtractor as unknown as import('../../types').ExtractorClass)
