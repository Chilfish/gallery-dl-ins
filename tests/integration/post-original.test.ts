import type { Message, Storage } from '../../src/types'
import { describe, expect, it } from 'vitest'
import { ConfigManager } from '../../src/config'
import { noopLogger } from '../../src/core/extractor'
import { InstagramPostExtractor } from '../../src/instagram/extractors'
import { MockHttpClient } from '../helpers/mock-http'

const mockStorage: Storage = {
  exists: async () => false,
  write: async () => {},
  mkdir: async () => {},
}

const mockUser = {
  pk: '12345',
  username: 'test_user',
  full_name: 'Test User',
}

/** Wrap a data payload the way Instagram server-renders a post page. */
function pageHtml(items: unknown[]): string {
  const payload = {
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
                  xdt_api__v1__media__shortcode__web_info: { items },
                },
              },
            },
          },
        ],
      ],
    ],
  }
  return `<html><body><script type="application/json" data-sjs>${JSON.stringify(payload)}</script></body></html>`
}

function makeExtractor(http: MockHttpClient, url: string): InstagramPostExtractor {
  const match = InstagramPostExtractor.pattern.exec(url)!
  return new InstagramPostExtractor({
    url,
    match,
    config: new ConfigManager(),
    http,
    storage: mockStorage,
    log: noopLogger,
    requestInterval: [0, 0],
  })
}

async function collect(extractor: InstagramPostExtractor): Promise<Message[]> {
  await extractor.initialize()
  const messages: Message[] = []
  for await (const msg of extractor)
    messages.push(msg)
  return messages
}

function restPost(): unknown {
  return {
    items: [
      {
        pk: '3400000000000000001',
        code: 'DY1p3ufmcBS',
        taken_at: 1717000000,
        user: mockUser,
        caption: { text: 'A photo' },
        like_count: 42,
        media_type: 1,
        original_width: 1440,
        original_height: 944,
        image_versions2: {
          candidates: [
            { url: 'https://cdn.example/1080.jpg', width: 1080, height: 708 },
            { url: 'https://cdn.example/366.jpg', width: 366, height: 240 },
          ],
        },
      },
    ],
    num_results: 1,
    more_available: false,
  }
}

function pageItem(): unknown {
  return {
    pk: '3400000000000000001',
    code: 'DY1p3ufmcBS',
    taken_at: 1717000000,
    user: mockUser,
    caption: { text: 'A photo' },
    like_count: 42,
    media_type: 1,
    original_width: 1440,
    original_height: 944,
    image_versions2: {
      candidates: [
        { url: 'https://cdn.example/1440.jpg', width: 1440, height: 944 },
        { url: 'https://cdn.example/1080.jpg', width: 1080, height: 708 },
      ],
    },
  }
}

describe('instagramPostExtractor original-size upgrade', () => {
  const url = 'https://www.instagram.com/p/DY1p3ufmcBS/'

  it('upgrades a downscaled REST candidate list from the post page', async () => {
    const http = new MockHttpClient()
      .add('/api/v1/media/', restPost())
      .add('/p/DY1p3ufmcBS/', pageHtml([
        pageItem(),
      ]))

    const messages = await collect(makeExtractor(http, url))
    const image = messages.find(m => m.type === 'url' && m.url.includes('.jpg'))
    expect(image?.type === 'url' && image.url).toBe('https://cdn.example/1440.jpg')
    expect(image?.type === 'url' && image.metadata.width).toBe(1440)
  })

  it('keeps REST output when --no-original disables the upgrade', async () => {
    const http = new MockHttpClient()
      .add('/api/v1/media/', restPost())
      .add('/p/DY1p3ufmcBS/', pageHtml([
        pageItem(),
      ]))

    const config = new ConfigManager()
    config.set('extractor.instagram.original', false)
    const match = InstagramPostExtractor.pattern.exec(url)!
    const extractor = new InstagramPostExtractor({
      url,
      match,
      config,
      http,
      storage: mockStorage,
      log: noopLogger,
      requestInterval: [0, 0],
    })

    const messages = await collect(extractor)
    const image = messages.find(m => m.type === 'url' && m.url.includes('.jpg'))
    expect(image?.type === 'url' && image.url).toBe('https://cdn.example/1080.jpg')
    expect(http.calls.filter(c => c.includes('/p/'))).toHaveLength(0)
  })

  it('skips the upgrade request when REST already returns the original size', async () => {
    const http = new MockHttpClient()
      .add('/api/v1/media/', {
        items: [
          {
            ...(pageItem() as Record<string, unknown>),
            image_versions2: {
              candidates: [
                { url: 'https://cdn.example/1440.jpg', width: 1440, height: 944 },
              ],
            },
          },
        ],
        more_available: false,
      })

    const messages = await collect(makeExtractor(http, url))
    const image = messages.find(m => m.type === 'url' && m.url.includes('.jpg'))
    expect(image?.type === 'url' && image.url).toBe('https://cdn.example/1440.jpg')
    expect(http.calls.filter(c => c.includes('/p/'))).toHaveLength(0)
  })

  it('falls back to the post page when REST fails', async () => {
    const http = new MockHttpClient()
      .add('/api/v1/media/', { message: 'Not logged in', status: 'fail' }, 404)
      .add('/p/DY1p3ufmcBS/', pageHtml([
        pageItem(),
      ]))

    const messages = await collect(makeExtractor(http, url))
    const directory = messages.find(m => m.type === 'directory')
    expect(directory?.type === 'directory' && directory.metadata.username).toBe('test_user')
    const image = messages.find(m => m.type === 'url' && m.url.includes('.jpg'))
    expect(image?.type === 'url' && image.url).toBe('https://cdn.example/1440.jpg')
  })
})
