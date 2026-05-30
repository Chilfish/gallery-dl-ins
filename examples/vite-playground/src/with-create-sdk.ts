/**
 * 场景 2：Node.js / Vercel serverless — createSDK + 自定义 storage。
 *
 * 预期：打包产物中应有 axios（adapter chunk），但不应有 fs/promises。
 * 因为传入了自定义 storage，storage chunk 的 import 路径不应被触发。
 *
 * 此文件为 Node.js 环境构建，不是浏览器。
 */

import { createSDK } from '@chilfish/gallery-dl-instagram'
import type { Storage } from '@chilfish/gallery-dl-instagram'

// 自定义 Storage：不上磁盘，只打印日志（模拟 Vercel 只读文件系统）
const noopStorage: Storage = {
  async exists(_path: string): Promise<boolean> { return false },
  async write(path: string, _data: Uint8Array | string): Promise<void> {
    console.log(`[with-create-sdk] 跳过写入: ${path}`)
  },
  async mkdir(_path: string): Promise<void> {},
}

const COOKIES = 'sessionid=fake; csrftoken=fake'

async function main() {
  const ig = await createSDK({ cookies: COOKIES, storage: noopStorage })

  console.log('[with-create-sdk] SDK 实例创建成功:', ig.constructor.name)
  console.log('[with-create-sdk] extract 方法存在:', typeof ig.extract === 'function')
}

main()

export { main }
