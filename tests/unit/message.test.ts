/**
 * Message factory tests — ensure correct shape of DirectoryMsg, UrlMsg, QueueMsg.
 */

import { directory, queue, url } from '../../message'

describe('directory', () => {
  it('creates a directory message with empty metadata by default', () => {
    const msg = directory()
    expect(msg.type).toBe('directory')
    expect(msg.metadata).toEqual({})
  })

  it('includes provided metadata', () => {
    const meta = { post_id: '123', username: 'test' }
    const msg = directory(meta)
    expect(msg.metadata).toEqual(meta)
  })
})

describe('url', () => {
  it('creates a url message', () => {
    const msg = url('https://example.com/photo.jpg')
    expect(msg.type).toBe('url')
    expect(msg.url).toBe('https://example.com/photo.jpg')
    expect(msg.metadata).toEqual({})
  })

  it('includes metadata', () => {
    const meta = { media_id: 'abc', width: 1080 }
    const msg = url('https://example.com/photo.jpg', meta)
    expect(msg.url).toBe('https://example.com/photo.jpg')
    expect(msg.metadata).toEqual(meta)
  })
})

describe('queue', () => {
  it('creates a queue message', () => {
    const msg = queue('https://www.instagram.com/user/posts/')
    expect(msg.type).toBe('queue')
    expect(msg.url).toBe('https://www.instagram.com/user/posts/')
    expect(msg.metadata._extractor).toBeUndefined()
  })

  it('includes _extractor in metadata when provided', () => {
    const mockExtractor = { pattern: /posts/, subcategory: 'posts' }
    const msg = queue('https://www.instagram.com/user/posts/', {
      _extractor: mockExtractor as any,
    })
    expect(msg.metadata._extractor).toBe(mockExtractor)
  })
})
