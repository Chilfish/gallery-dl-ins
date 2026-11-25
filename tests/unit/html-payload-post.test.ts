import type { InstagramPost } from '../../src/instagram/types'
import { describe, expect, it } from 'vitest'
import { extractMediaFromPage } from '../../src/instagram/html-payload'

function wrap(payload: unknown): string {
  return `<html><body>`
    + `<script type="application/json" nonce="abc" data-content-len="1" data-sjs>${JSON.stringify(payload)}</script>`
    + `</body></html>`
}

function preload(data: unknown): string {
  return wrap({
    require: [
      [
        'ScheduledServerJS',
        'handle',
        null,
        [
          {
            __bbox: {
              result: { data },
            },
          },
        ],
      ],
    ],
  })
}

function candidate(url: string, width?: number, height?: number) {
  return width == null
    ? { url }
    : { url, width, height }
}

describe('extractMediaFromPage', () => {
  it('reads the logged-in web_info item', () => {
    const html = preload({
      xdt_api__v1__media__shortcode__web_info: {
        items: [
          {
            pk: '111',
            code: 'CxAbCdEfGh',
            media_type: 1,
            original_width: 1440,
            original_height: 944,
            image_versions2: {
              candidates: [
                candidate('https://cdn/large.jpg', 1440, 944),
                candidate('https://cdn/small.jpg', 1080, 708),
              ],
            },
          },
        ],
      },
    })

    const media = extractMediaFromPage(html)
    expect(media?.pk).toBe('111')
    expect(media?.code).toBe('CxAbCdEfGh')
    const candidates = (media!.image_versions2 as { candidates: Array<{ width: number }> }).candidates
    expect(candidates[0]?.width).toBe(1440)
  })

  it('reads the logged-out xig_polaris_media node under if_not_gated_logged_out', () => {
    const html = preload({
      xig_polaris_media: {
        pk: 'outer',
        code: 'CxAbCdEfGh',
        if_not_gated_logged_out: {
          pk: '222',
          code: 'CxAbCdEfGh',
          media_type: 1,
          original_width: 1440,
          original_height: 944,
          image_versions2: {
            candidates: [
              candidate('https://cdn/large.jpg'),
            ],
          },
        },
      },
    })

    const media = extractMediaFromPage(html)
    expect(media?.pk).toBe('222')
  })

  it('seeds dimensions for sizeless logged-out candidates from the original size', () => {
    const html = preload({
      xig_polaris_media: {
        pk: '333',
        code: 'CxAbCdEfGh',
        media_type: 1,
        original_width: 3072,
        original_height: 4096,
        image_versions2: {
          candidates: [
            candidate('https://cdn/original.jpg'),
            candidate('https://cdn/1080.jpg'),
          ],
        },
      },
    })

    const media = extractMediaFromPage(html)
    const candidates = (media!.image_versions2 as { candidates: Array<{ width?: number, height?: number }> }).candidates
    expect(candidates[0]?.width).toBe(3072)
    expect(candidates[0]?.height).toBe(4096)
    expect(candidates[1]?.width).toBeUndefined()
  })

  it('seeds dimensions for carousel children too', () => {
    const html = preload({
      xig_polaris_media: {
        pk: '444',
        code: 'CxAbCdEfGh',
        media_type: 8,
        original_width: 1440,
        original_height: 1654,
        image_versions2: {
          candidates: [
            candidate('https://cdn/top.jpg'),
          ],
        },
        carousel_media: [
          {
            pk: '444-1',
            media_type: 1,
            original_width: 1440,
            original_height: 1654,
            image_versions2: {
              candidates: [
                candidate('https://cdn/child.jpg'),
              ],
            },
          },
        ],
      },
    })

    const media = extractMediaFromPage(html)
    const children = media!.carousel_media as Array<{
      image_versions2: { candidates: Array<{ width?: number }> }
    }>
    expect(children[0]?.image_versions2.candidates[0]?.width).toBe(1440)
  })

  it('returns null for pages without a data-sjs payload', () => {
    expect(extractMediaFromPage('<html><body>Instagram</body></html>')).toBeNull()
  })

  it('returns null when data-sjs blocks carry no post payload', () => {
    expect(extractMediaFromPage(preload({ require: [] }))).toBeNull()
  })

  it('skips malformed JSON blocks and continues scanning', () => {
    const html = `<html><script type="application/json" data-sjs>{bad json</script>`
      + `<script type="application/json" data-sjs>{"xdt_api__v1__media__shortcode__web_info":{"items":[{"pk":"9","code":"abc"}]}}</script></html>`

    expect(extractMediaFromPage(html)?.pk).toBe('9')
  })
})

describe('extractMediaFromPage typed as InstagramPost', () => {
  it('yields an object the REST parser can consume', () => {
    const html = preload({
      xdt_api__v1__media__shortcode__web_info: {
        items: [
          {
            pk: '555',
            code: 'CxAbCdEfGh',
            taken_at: 1_700_000_000,
            media_type: 1,
            user: { pk: '9', username: 'u', full_name: 'U' },
            caption: { text: 'hi' },
            original_width: 1440,
            original_height: 960,
            image_versions2: {
              candidates: [
                candidate('https://cdn/a.jpg', 1440, 960),
              ],
            },
          },
        ],
      },
    })

    const media = extractMediaFromPage(html) as unknown as InstagramPost
    expect(media.user.username).toBe('u')
    expect(media.image_versions2.candidates[0]?.url).toBe('https://cdn/a.jpg')
  })
})
