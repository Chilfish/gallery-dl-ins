/**
 * Instagram sub-extractors — one class per resource type.
 */

import type { ExtractorClass, MessageIter, Metadata } from '../types'
import type { InstagramExtractorOptions } from './base'
import type { InstagramPost, InstagramUser } from './types'
import { directory, queue } from '../message'
import { shortcodeFromId } from '../utils/id-codec'
import { ensureHttpScheme } from '../utils/text'
import { InstagramExtractor } from './base'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_RE = /^(?:https?:\/\/)?(?:www\.)?instagram\.com/

function re(base: RegExp, path: RegExp | string): RegExp {
  const pathSrc = typeof path === 'string' ? path : path.source
  return new RegExp(base.source + pathSrc, 'i')
}

// ---------------------------------------------------------------------------
// InstagramPostExtractor
// ---------------------------------------------------------------------------

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
    let shortcode: string | undefined
      = groups[4] ?? groups[3] ?? groups[2] ?? groups[1]
    if (!shortcode)
      return

    if (groups[1] === '') {
      // Share link — follow redirect
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

// ---------------------------------------------------------------------------
// InstagramUserExtractor (Dispatch hub)
// ---------------------------------------------------------------------------

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
    if (!match)
      return null
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
        ? [
            'posts',
            'reels',
            'tagged',
            'stories',
            'highlights',
            'info',
            'avatar',
          ]
        : typeof include === 'string'
          ? include.replace(/\s+/g, '').split(',')
          : include

    const extractors: Record<
      string,
      { cls: ExtractorClass, url: string }
    > = {
      info: {
        cls: InstagramInfoExtractor as unknown as ExtractorClass,
        url: `${base}info/`,
      },
      avatar: {
        cls: InstagramAvatarExtractor as unknown as ExtractorClass,
        url: `${base}avatar/`,
      },
      stories: {
        cls: InstagramStoriesExtractor as unknown as ExtractorClass,
        url: storiesUrl,
      },
      highlights: {
        cls: InstagramHighlightsExtractor as unknown as ExtractorClass,
        url: `${base}highlights/`,
      },
      posts: {
        cls: InstagramPostsExtractor as unknown as ExtractorClass,
        url: `${base}posts/`,
      },
      reels: {
        cls: InstagramReelsExtractor as unknown as ExtractorClass,
        url: `${base}reels/`,
      },
      tagged: {
        cls: InstagramTaggedExtractor as unknown as ExtractorClass,
        url: `${base}tagged/`,
      },
    }

    for (const cat of categories) {
      const entry = extractors[cat]
      if (entry) {
        yield queue(entry.url, { _extractor: entry.cls })
      }
      else {
        this.log.warn(`Invalid include '${cat}'`)
      }
    }
  }

  override async* posts(): AsyncGenerator<InstagramPost> {}
}

// ---------------------------------------------------------------------------
// InstagramPostsExtractor
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// InstagramReelsExtractor
// ---------------------------------------------------------------------------

export class InstagramReelsExtractor extends InstagramExtractor {
  static readonly subcategory = 'reels'
  static override pattern = re(BASE_RE, /(\/[^/?#]+)\/reels/)

  override readonly subcategory = InstagramReelsExtractor.subcategory

  constructor(opts: InstagramExtractorOptions) {
    super(opts)
  }

  static fromURL(
    url: string,
    opts: InstagramExtractorOptions,
  ): InstagramReelsExtractor | null {
    const match = InstagramReelsExtractor.pattern.exec(url)
    if (!match)
      return null
    return new InstagramReelsExtractor({ ...opts, url, match })
  }

  override async* posts(): AsyncGenerator<InstagramPost> {
    const screenName = (this.groups[0] ?? '').replace(/^\//, '')
    const uid = await this.api.userId(screenName)
    yield* this.api.userClips(uid)
  }
}

// ---------------------------------------------------------------------------
// InstagramTaggedExtractor
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// InstagramStoriesExtractor
// ---------------------------------------------------------------------------

export class InstagramStoriesExtractor extends InstagramExtractor {
  static readonly subcategory = 'stories'
  static override pattern
    = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:stories\/(?:highlights\/(\d+)|([^/?#]+)(?:\/(\d+))?)|\/(aGlnaGxpZ2h0[^?#]+)(?:\?story_media_id=(\d+))?)/

  override readonly subcategory = InstagramStoriesExtractor.subcategory
  private highlightId: string | null = null
  private mediaId: string | null = null

  constructor(opts: InstagramExtractorOptions) {
    super(opts)
    const groups = this.groups as string[]
    const h1 = groups[0]
    const user = groups[1]
    const m1 = groups[2]
    const h2 = groups[3]
    const m2 = groups[4]

    if (user) {
      (this as { subcategory: string }).subcategory = 'stories'
      this.highlightId = null
    }
    else {
      (this as { subcategory: string }).subcategory = 'highlights'
      this.highlightId = h1
        ? `highlight:${h1}`
        : `highlight:${Buffer.from(h2 ?? '', 'base64').toString('utf-8')}`
    }

    this.mediaId = m1 ?? m2 ?? null
  }

  static fromURL(
    url: string,
    opts: InstagramExtractorOptions,
  ): InstagramStoriesExtractor | null {
    const match = InstagramStoriesExtractor.pattern.exec(url)
    if (!match)
      return null
    return new InstagramStoriesExtractor({ ...opts, url, match })
  }

  override async* posts(): AsyncGenerator<InstagramPost> {
    const reelId = this.highlightId
      ? this.highlightId
      : await this.api.userId((this.groups[1] ?? '').toString())

    const reels = await this.api.reelsMedia([reelId])
    if (!reels.length)
      return

    if (this.mediaId) {
      const reel = reels[0]!
      for (const item of reel.items ?? []) {
        if (item.pk === this.mediaId) {
          reel.items = [item]
          break
        }
      }
      yield reel
      return
    }

    const split = this._cfg('split', false) as boolean
    if (split) {
      const reel = reels[0]!
      for (const item of reel.items ?? []) {
        const copy = { ...reel }
        copy.items = [item]
        yield copy
      }
    }
    else {
      yield* reels
    }
  }
}

// ---------------------------------------------------------------------------
// InstagramHighlightsExtractor
// ---------------------------------------------------------------------------

export class InstagramHighlightsExtractor extends InstagramExtractor {
  static readonly subcategory = 'highlights'
  static override pattern = re(BASE_RE, /(\/[^/?#]+)\/highlights/)

  override readonly subcategory = InstagramHighlightsExtractor.subcategory

  constructor(opts: InstagramExtractorOptions) {
    super(opts)
  }

  static fromURL(
    url: string,
    opts: InstagramExtractorOptions,
  ): InstagramHighlightsExtractor | null {
    const match = InstagramHighlightsExtractor.pattern.exec(url)
    if (!match)
      return null
    return new InstagramHighlightsExtractor({ ...opts, url, match })
  }

  override async* posts(): AsyncGenerator<InstagramPost> {
    const screenName = (this.groups[0] ?? '').replace(/^\//, '')
    const uid = await this.api.userId(screenName)
    yield* this.api.highlightsMedia(uid)
  }
}

// ---------------------------------------------------------------------------
// InstagramTagExtractor
// ---------------------------------------------------------------------------

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
    if (!match)
      return null
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

// ---------------------------------------------------------------------------
// InstagramInfoExtractor
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// InstagramAvatarExtractor
// ---------------------------------------------------------------------------

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
    if (!match)
      return null
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

// ---------------------------------------------------------------------------
// InstagramSavedExtractor
// ---------------------------------------------------------------------------

export class InstagramSavedExtractor extends InstagramExtractor {
  static readonly subcategory = 'saved'
  static override pattern = re(
    BASE_RE,
    /(\/[^/?#]+)\/saved(?:\/all-posts)?\/?$/,
  )

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
