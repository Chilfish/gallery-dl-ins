/**
 * Node.js Storage — fs/promises wrapper.
 *
 * Isolated from the HTTP adapter so that bundlers can tree-shake
 * ``node:fs`` when a custom ``Storage`` is provided (e.g. Vercel serverless).
 */

import type { Storage } from '../types'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export function createStorage(): Storage {
  return {
    async exists(path: string): Promise<boolean> {
      try {
        await access(path)
        return true
      }
      catch {
        return false
      }
    },

    async write(path: string, data: Uint8Array | string): Promise<void> {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, data)
    },

    async mkdir(path: string): Promise<void> {
      await mkdir(path, { recursive: true })
    },
  }
}
