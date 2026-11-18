import { describe, expect, it } from 'vitest'
import { extractReelsMediaFromPage } from '../../src/instagram/html-payload'

function wrap(payload: unknown): string {
  return `<html><body>`
    + `<script type="application/json" nonce="abc" data-content-len="1" data-sjs>${JSON.stringify(payload)}</script>`
    + `</body></html>`
}

describe('extractReelsMediaFromPage', () => {
  it('finds reels_media nested in ScheduledServerJS data blocks', () => {
    const html = wrap({
      require: [
        [
          'ScheduledServerJS',
          'handle',
          null,
          [
            {
              __bbox: {
                result: {
                  data: {
                    xdt_api__v1__feed__reels_media: {
                      reels_media: [
                        {
                          id: '76727580985',
                          items: [
                            { pk: '4030277734609603578_76727580985' },
                          ],
                        },
                      ],
                    },
                  },
                },
              },
            },
          ],
        ],
      ],
    })

    const reels = extractReelsMediaFromPage(html)
    expect(reels).toHaveLength(1)
    expect(reels?.[0]?.id).toBe('76727580985')
    expect(reels?.[0]?.items?.[0]?.pk).toBe('4030277734609603578_76727580985')
  })

  it('reads reels_media__connection edges from highlights pages', () => {
    const html = wrap({
      require: [
        [
          'ScheduledServerJS',
          'handle',
          null,
          [
            {
              __bbox: {
                result: {
                  data: {
                    xdt_api__v1__feed__reels_media__connection: {
                      edges: [
                        {
                          node: {
                            id: 'highlight:18115369870628555',
                            title: '🌸お花🌸',
                            items: [
                              { pk: '3827367937251133646' },
                            ],
                          },
                        },
                        {
                          node: {
                            id: 'highlight:2',
                          },
                        },
                      ],
                    },
                  },
                },
              },
            },
          ],
        ],
      ],
    })

    const reels = extractReelsMediaFromPage(html)
    expect(reels?.map(reel => reel.id)).toEqual([
      'highlight:18115369870628555',
      'highlight:2',
    ])
    expect(reels?.[0]?.title).toBe('🌸お花🌸')
    expect(reels?.[0]?.items?.[0]?.pk).toBe('3827367937251133646')
  })

  it('returns an empty array when the payload contains no reels', () => {
    const html = wrap({
      require: [
        [
          'ScheduledServerJS',
          'handle',
          null,
          [
            {
              __bbox: {
                result: {
                  data: {
                    xdt_api__v1__feed__reels_media: { reels_media: [] },
                  },
                },
              },
            },
          ],
        ],
      ],
    })

    expect(extractReelsMediaFromPage(html)).toEqual([])
  })

  it('returns null for pages without a data-sjs payload', () => {
    expect(extractReelsMediaFromPage('<html><body>error</body></html>')).toBeNull()
  })

  it('returns null when data-sjs blocks exist but carry no reels payload', () => {
    const html = wrap({
      require: [
        [
          'ScheduledServerJS',
          'handle',
          null,
          [
            { __bbox: {} },
          ],
        ],
      ],
    })
    expect(extractReelsMediaFromPage(html)).toBeNull()
  })

  it('skips malformed JSON blocks and continues scanning', () => {
    const html = `<html><script type="application/json" data-sjs>{bad json</script>`
      + `<script type="application/json" data-sjs>{"xdt_api__v1__feed__reels_media":{"reels_media":[{"id":"1"}]}}</script></html>`

    const reels = extractReelsMediaFromPage(html)
    expect(reels).toHaveLength(1)
    expect(reels?.[0]?.id).toBe('1')
  })
})
