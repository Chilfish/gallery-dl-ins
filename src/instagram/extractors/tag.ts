import type { InstagramExtractorOptions } from '../base'
import type { InstagramPost } from '../types'
import { InstagramExtractor } from '../base'
import { BASE_RE, re } from './helpers'
import { register } from './registry'

export class InstagramTagExtractor extends InstagramExtractor {
  static readonly subcategory = 'tag'
  static override pattern = re(BASE_RE, /\/explore\/tags\/([^/?#]+)/)

  override readonly subcategory = InstagramTagExtractor.subcategory

  constructor(opts: InstagramExtractorOptions) {
    super(opts)
  }

  static fromURL(
    url: string,
    opts: InstagramExtractorOptions,
  ): InstagramTagExtractor | null {
    const match = InstagramTagExtractor.pattern.exec(url)
    if (!match) return null
    return new InstagramTagExtractor({ ...opts, url, match })
  }

  override async metadata(): Promise<Record<string, unknown>> {
    const tag = this.groups[0] ?? ''
    return { tag: decodeURIComponent(tag) }
  }

  override async* posts(): AsyncGenerator<InstagramPost> {
    const tag = this.groups[0] ?? ''
    yield* this.api.tagsMedia(decodeURIComponent(tag))
  }
}

register(InstagramTagExtractor.subcategory, InstagramTagExtractor as unknown as import('../../types').ExtractorClass)
