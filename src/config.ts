/**
 * Simple nested config reader.
 *
 * Mirrors gallery-dl's ``config.interpolate``:
 *
 *   cfgPath like ``['extractor', 'instagram', 'post']``
 *   looks up: extractor.instagram.post.{key}, extractor.instagram.{key},
 *   extractor.{key}
 */

import type { Config, ConfigValue } from './types'

export class ConfigManager {
  private readonly data: Config

  constructor(data: Config = {}) {
    this.data = data
  }

  /**
   * Read a value at a dot-path like ``'extractor.instagram.videos'``.
   * Returns ``undefined`` when the path doesn't exist.
   */
  get(path: string, defaultValue?: ConfigValue): ConfigValue | undefined {
    const keys = path.split('.')
    let node: unknown = this.data
    for (const key of keys) {
      if (node == null || typeof node !== 'object' || Array.isArray(node)) {
        return defaultValue
      }
      node = (node as Record<string, unknown>)[key]
    }
    if (node === undefined)
      return defaultValue
    return node as ConfigValue
  }

  /**
   * Interpolate a config key through a hierarchy of paths.
   */
  interpolate(
    cfgPath: readonly string[],
    key: string,
    defaultVal?: ConfigValue,
  ): ConfigValue | undefined {
    let node: unknown = this.data

    for (let i = 0; i < cfgPath.length; i++) {
      if (node != null && typeof node === 'object' && !Array.isArray(node)) {
        const v = (node as Record<string, unknown>)[key]
        if (v !== undefined)
          return v as ConfigValue
      }
      if (node == null || typeof node !== 'object' || Array.isArray(node)) {
        break
      }
      node = (node as Record<string, unknown>)[cfgPath[i]!]
    }

    return defaultVal
  }

  /**
   * Mutate the config at a given dot-path.
   */
  set(path: string, value: unknown): void {
    const keys = path.split('.')
    let node: Record<string, unknown> = this.data as Record<string, unknown>
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i]!
      let child = node[key]
      if (child == null || typeof child !== 'object' || Array.isArray(child)) {
        child = {}
        node[key] = child
      }
      node = child as Record<string, unknown>
    }
    node[keys[keys.length - 1]!] = value
  }
}
