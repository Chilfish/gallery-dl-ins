import type { RequestConfig } from '../../src/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFetchHttpClient } from '../../src/fetcher'
import {
  assertHttpProxy,
  createBunProxyHttpClient,
  createProxyHttpClient,
  isBunRuntime,
} from '../../src/proxy'

describe('assertHttpProxy', () => {
  it('accepts http and https proxies', () => {
    expect(() => assertHttpProxy('http://127.0.0.1:7890')).not.toThrow()
    expect(() => assertHttpProxy('https://proxy.example.com:443')).not.toThrow()
  })

  it('rejects schemes the fetch transport cannot handle', () => {
    expect(() => assertHttpProxy('socks5://127.0.0.1:1080')).toThrow(/Unsupported proxy scheme/)
  })
})

describe('isBunRuntime', () => {
  it('is false under Node', () => {
    expect(isBunRuntime()).toBe(false)
  })

  it('detects the Bun global', () => {
    vi.stubGlobal('Bun', {})
    try {
      expect(isBunRuntime()).toBe(true)
    }
    finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('createProxyHttpClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws a pointer to the Node helper outside Bun', () => {
    expect(() => createProxyHttpClient('http://127.0.0.1:7890'))
      .toThrow(/createProxyFetch/)
  })

  it('uses the native Bun proxy option under Bun', () => {
    vi.stubGlobal('Bun', {})
    expect(() => createBunProxyHttpClient('http://127.0.0.1:7890')).not.toThrow()
  })
})

describe('createFetchHttpClient init hook', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('merges the per-request init into the fetch call', async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const init = vi.fn((_config: RequestConfig) => ({ cache: 'no-store' }) as RequestInit)
    const http = createFetchHttpClient({ cookie: 'sessionid=abc', init })

    await http.request({ url: 'https://example.com/api' })

    expect(init).toHaveBeenCalledTimes(1)
    expect(init.mock.calls[0]?.[0]).toMatchObject({ url: 'https://example.com/api' })

    const initArg = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(initArg.cache).toBe('no-store')
    expect((initArg.headers as Headers).get('Cookie')).toBe('sessionid=abc')
  })
})
