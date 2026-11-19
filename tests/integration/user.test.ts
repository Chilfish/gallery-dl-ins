import type { Message, Storage } from '../../src/types'
import { describe, expect, it } from 'vitest'
import { ConfigManager } from '../../src/config'
import { DownloadJob } from '../../src/core/download-job'
import { noopLogger } from '../../src/core/extractor'
import { InstagramPostsExtractor, InstagramUserExtractor } from '../../src/instagram/extractors'
import { MockHttpClient } from '../helpers/mock-http'

const mockStorage: Storage = {
  exists: async () => false,
  write: async () => {},
  mkdir: async () => {},
}

describe('instagramUserExtractor integration', () => {
  const url = 'https://www.instagram.com/watase_yuzuki/'

  it('yields queue messages for posts by default', async () => {
    const http = new MockHttpClient()

    const match = InstagramUserExtractor.pattern.exec(url)!
    const config = new ConfigManager()
    // Default include is 'posts'
    config.set('extractor.instagram.include', 'posts')

    const extractor = new InstagramUserExtractor({
      url,
      match,
      config,
      http,
      storage: mockStorage,
      log: noopLogger,
      requestInterval: [0, 0],
    })

    await extractor.initialize()
    const messages: Message[] = []
    for await (const msg of extractor) {
      messages.push(msg)
    }

    // With include=posts, should yield 1 queue message
    const queues = messages.filter(m => m.type === 'queue')
    expect(queues.length).toBe(1)
    if (queues[0] && queues[0].type === 'queue') {
      expect(queues[0].url).toContain('watase_yuzuki')
      expect(queues[0].url).toContain('posts')
    }
  })

  it('dispatches multiple categories with include=all', async () => {
    const http = new MockHttpClient()

    const match = InstagramUserExtractor.pattern.exec(url)!
    const config = new ConfigManager()
    config.set('extractor.instagram.include', 'all')

    const extractor = new InstagramUserExtractor({
      url,
      match,
      config,
      http,
      storage: mockStorage,
      log: noopLogger,
      requestInterval: [0, 0],
    })

    await extractor.initialize()
    const messages: Message[] = []
    for await (const msg of extractor) {
      messages.push(msg)
    }

    const queues = messages.filter(m => m.type === 'queue')
    // include=all → posts, reels, tagged, stories, highlights, info, avatar = 7
    expect(queues.length).toBe(7)
  })

  it('downloadJob processes queue messages and passes parent deps to children', async () => {
    const http = new MockHttpClient()
    // Mock endpoints that child extractors call during initialization
    http.add('/api/v1/feed/user/', { items: [], num_results: 0, more_available: false })
    http.add('/web/search/topsearch/', {
      users: [
        {
          user: {
            pk: '123',
            id: '123',
            username: 'watase_yuzuki',
            full_name: 'Watase Yuzuki',
            is_private: false,
          },
        },
      ],
    })
    http.add('/api/v1/users/web_profile_info/', {
      data: {
        user: {
          pk: '123',
          id: '123',
          username: 'watase_yuzuki',
          full_name: 'Watase Yuzuki',
          is_private: false,
        },
      },
    })

    const match = InstagramUserExtractor.pattern.exec(url)!
    const config = new ConfigManager()
    config.set('extractor.instagram.include', 'posts')

    const extractor = new InstagramUserExtractor({
      url,
      match,
      config,
      http,
      storage: mockStorage,
      log: noopLogger,
      requestInterval: [0, 0],
    })

    const job = new DownloadJob(extractor as any)
    ;(job as any).basePath = './test-output'
    const status = await job.run()

    // Should complete without error (the queue dispatch works even with 0 posts)
    expect(status).toBe(0)
  })
})

describe('instagramPostsExtractor GraphQL integration', () => {
  it('reads posts from the doc_id GraphQL endpoint', async () => {
    const post = {
      pk: '3400000000000000003',
      code: 'GraphqlPost1',
      taken_at: 1_717_000_000,
      user: { pk: '9', username: 'graphql_user', full_name: 'GraphQL User' },
      caption: { text: 'hello #graphql' },
      like_count: 3,
      image_versions2: {
        candidates: [
          { url: 'https://example.com/graphql.jpg', width: 1080, height: 1350 },
        ],
      },
    }

    const http = new MockHttpClient()
      .add('i.instagram.com/api/graphql', JSON.stringify({
        data: {
          xdt_api__v1__feed__user_timeline_graphql_connection: {
            edges: [
              { node: post },
            ],
            page_info: { has_next_page: false, end_cursor: null },
          },
        },
      }))
      .add('/api/v1/users/web_profile_info/', JSON.stringify({
        data: {
          user: {
            pk: '9',
            id: '9',
            username: 'graphql_user',
            full_name: 'GraphQL User',
          },
        },
      }))
      .add('https://www.instagram.com/', '<html>"LSD",[],{"token":"lsd-token"}</html>')

    const config = new ConfigManager()
    config.set('extractor.instagram.user-strategy', ['info'])

    const url = 'https://www.instagram.com/graphql_user/posts/'
    const match = InstagramPostsExtractor.pattern.exec(url)!
    const extractor = new InstagramPostsExtractor({
      url,
      match,
      config,
      http,
      storage: mockStorage,
      log: noopLogger,
      requestInterval: [0, 0],
    })

    await extractor.initialize()
    const messages: Message[] = []
    for await (const msg of extractor) {
      messages.push(msg)
    }

    const directory = messages.find(m => m.type === 'directory')
    expect(directory).toBeDefined()
    if (directory && directory.type === 'directory') {
      expect(directory.metadata.username).toBe('graphql_user')
      expect(directory.metadata.post_shortcode).toBe('GraphqlPost1')
    }

    const urls = messages.filter(m => m.type === 'url')
    expect(urls.some(m => m.type === 'url' && m.url === 'https://example.com/graphql.jpg'))
      .toBe(true)
  })
})
