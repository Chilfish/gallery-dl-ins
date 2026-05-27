import { describe, it, expect } from 'vitest'
import { ConfigManager } from '../../config'
import { InstagramUserExtractor } from '../../instagram/extractors'
import { noopLogger } from '../../core/extractor'
import { MockHttpClient } from '../helpers/mock-http'
import type { Storage, Message } from '../../types'

const mockStorage: Storage = {
  exists: async () => false,
  write: async () => {},
  mkdir: async () => {},
}

describe('InstagramUserExtractor integration', () => {
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
})
