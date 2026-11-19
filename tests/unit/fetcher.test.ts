import { describe, expect, it } from 'vitest'
import { buildUrl, extractCsrf, mergeCookie, serializeBody } from '../../src/fetcher'

describe('mergeCookie', () => {
  it('keeps both sides when names differ', () => {
    expect(mergeCookie('a=1; b=2', 'c=3')).toBe('a=1; b=2; c=3')
  })

  it('deduplicates names and lets the extra cookie win', () => {
    expect(mergeCookie('sessionid=abc; csrftoken=old', 'csrftoken=new'))
      .toBe('sessionid=abc; csrftoken=new')
  })

  it('preserves values containing equals signs', () => {
    expect(mergeCookie(null, 'token=a=b=c')).toBe('token=a=b=c')
  })

  it('returns the extra string when there is no base', () => {
    expect(mergeCookie(null, 'a=1')).toBe('a=1')
  })
})

describe('extractCsrf', () => {
  it('reads csrftoken from a cookie header', () => {
    expect(extractCsrf('sessionid=abc; csrftoken=tok123; mid=x')).toBe('tok123')
  })

  it('returns an empty string when csrftoken is absent', () => {
    expect(extractCsrf('sessionid=abc')).toBe('')
  })
})

describe('buildUrl', () => {
  it('appends query parameters', () => {
    expect(buildUrl('https://example.com/api', { count: 30, max_id: null }))
      .toBe('https://example.com/api?count=30')
  })

  it('uses an ampersand when the base already has a query', () => {
    expect(buildUrl('https://example.com/api?x=1', { y: 2 }))
      .toBe('https://example.com/api?x=1&y=2')
  })

  it('returns the base when no params remain', () => {
    expect(buildUrl('https://example.com/api', { max_id: null }))
      .toBe('https://example.com/api')
  })
})

describe('serializeBody', () => {
  it('passes through strings and URLSearchParams', () => {
    const params = new URLSearchParams({ a: '1' })
    expect(serializeBody('raw')).toBe('raw')
    expect(serializeBody(params)).toBe(params)
  })

  it('jSON-encodes plain objects', () => {
    expect(serializeBody({ a: 1 })).toBe('{"a":1}')
  })

  it('returns undefined for nullish data', () => {
    expect(serializeBody(null)).toBeUndefined()
  })
})
