/**
 * 场景 1：浏览器环境 — 只用平台无关的 InstagramSDK，不碰 createSDK。
 *
 * 预期：打包产物中不应出现 axios / fs / path / cli/adapter / cli/storage。
 */

import { InstagramSDK } from '@chilfish/gallery-dl-instagram'
import type { HttpClient, HttpResponse } from '@chilfish/gallery-dl-instagram'

// 浏览器 fetch-based HttpClient
const fetchClient: HttpClient = {
  async request<T = unknown>(config): Promise<HttpResponse<T>> {
    const resp = await fetch(config.url, {
      method: config.method ?? 'GET',
      headers: config.headers as Record<string, string>,
    })
    const data = await resp.json() as T
    return {
      data,
      status: resp.status,
      headers: Object.fromEntries(resp.headers.entries()),
      url: resp.url,
    }
  },
}

const ig = new InstagramSDK({
  http: fetchClient,
  log: console,
})

console.log('[sdk-only] SDK 实例创建成功:', ig.constructor.name)

// 验证 extract 可用（不实际调用，这个 demo 只验证打包）
console.log('[sdk-only] extract 方法存在:', typeof ig.extract === 'function')
console.log('[sdk-only] download 方法存在:', typeof ig.download === 'function')

export { ig }
