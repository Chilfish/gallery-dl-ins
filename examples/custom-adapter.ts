/**
 * 自定义 Adapter 示例：展示如何在非 Node.js 环境下使用 SDK。
 *
 * 本例演示：
 *  - 如何自定义 HttpClient（fetch-based，可用于浏览器/Deno/Edge）
 *  - 如何自定义 Storage（内存存储，不上磁盘）
 *  - 如何自定义 Logger
 *
 * 这些接口就是平台无关层的全部契约。
 */

import type { HttpClient, HttpResponse, Storage } from '../src/types'
import { InstagramSDK } from '../src/index'

/** 使用 fetch API 的 HttpClient（浏览器 / Deno 兼容） */
const fetchHttpClient: HttpClient = {
  async request<T = unknown>(
    config: { url: string, method?: string, headers?: Record<string, string>, params?: Record<string, string | number | null | undefined>, data?: unknown, signal?: AbortSignal, timeout?: number, responseType?: 'arraybuffer' | 'text' | 'json' },
  ): Promise<HttpResponse<T>> {
    const url = new URL(config.url)
    if (config.params) {
      for (const [k, v] of Object.entries(config.params)) {
        url.searchParams.set(k, String(v))
      }
    }

    const headers = new Headers(config.headers as Record<string, string>)
    // Instagram 要求 CSRF token 同时作为 cookie 和 header
    const csrf = (config.headers?.['x-csrftoken'] as string) ?? ''
    if (csrf) {
      headers.set('Cookie', `csrftoken=${csrf}; ${headers.get('Cookie') ?? ''}`)
    }

    const resp = await fetch(url.toString(), {
      method: config.method ?? 'GET',
      headers,
      body: config.data
        ? JSON.stringify(config.data)
        : undefined,
      redirect: 'follow',
    })

    const data = (resp.status === 204
      ? ''
      : await resp.json().catch(() => resp.text())) as T

    const result: HttpResponse<T> = {
      data,
      status: resp.status,
      headers: Object.fromEntries(resp.headers.entries()),
      url: resp.url,
    }
    return result
  },
}

/** 内存 Storage（不写磁盘，适合预览/调试） */
const memoryStorage: Storage = {
  async exists(_path: string): Promise<boolean> { return false },
  async write(path: string, data: Uint8Array | string): Promise<void> {
    const size = typeof data === 'string'
      ? data.length
      : data.byteLength
    console.log(`  💾 [memory] 写入: ${path} (${(size / 1024).toFixed(1)} KB)`)
  },
  async mkdir(_path: string): Promise<void> {
    // no-op
  },
}

const ig = new InstagramSDK({
  http: fetchHttpClient,
  storage: memoryStorage,
  log: console,
})

console.log('🔧 使用自定义 fetch-based adapter\n')

const postUrl = 'https://www.instagram.com/p/DY1p3ufmcBS/?img_index=1'

for await (const msg of ig.extract(postUrl)) {
  if (msg.type === 'url') {
    console.log(`  📎 ${msg.url}`)
  }
}

console.log('\n✅ 自定义 adapter 工作正常')
