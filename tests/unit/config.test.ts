import { describe, expect, it } from 'vitest'
/**
 * ConfigManager tests — nested config get/set/interpolate.
 */

import { ConfigManager } from '../../src/config'

describe('configManager.get', () => {
  const cfg = new ConfigManager({
    app: {
      name: 'test-app',
      version: '1.0.0',
      nested: { deep: 'value' },
    },
    flag: true,
    count: 42,
  })

  it('reads a simple dot-path', () => {
    expect(cfg.get('flag')).toBe(true)
    expect(cfg.get('count')).toBe(42)
  })

  it('reads a nested dot-path', () => {
    expect(cfg.get('app.name')).toBe('test-app')
    expect(cfg.get('app.version')).toBe('1.0.0')
    expect(cfg.get('app.nested.deep')).toBe('value')
  })

  it('returns default value when path not found', () => {
    expect(cfg.get('nonexistent', 'fallback')).toBe('fallback')
    expect(cfg.get('app.nonexistent', 999)).toBe(999)
  })

  it('returns undefined when no default and path not found', () => {
    expect(cfg.get('nonexistent')).toBeUndefined()
    expect(cfg.get('app.deep.nonexistent')).toBeUndefined()
  })
})

describe('configManager.set', () => {
  it('creates a nested path and sets value', () => {
    const cfg = new ConfigManager()
    cfg.set('a.b.c', 'hello')
    expect(cfg.get('a.b.c')).toBe('hello')
    expect(cfg.get('a.b')).toEqual({ c: 'hello' })
  })

  it('updates an existing value', () => {
    const cfg = new ConfigManager({ key: 'old' })
    cfg.set('key', 'new')
    expect(cfg.get('key')).toBe('new')
  })

  it('overwrites a nested value', () => {
    const cfg = new ConfigManager({
      a: {
        b: { c: 1 },
      },
    })
    cfg.set('a.b.d', 2)
    expect(cfg.get('a.b.c')).toBe(1)
    expect(cfg.get('a.b.d')).toBe(2)
  })
})

describe('configManager.interpolate', () => {
  it('looks up key at first ancestor level that has it (root → leaf order)', () => {
    // interpolate walks cfgPath forward (root → extractor → instagram → post),
    // checking each level's node for the key. It returns the FIRST match it finds.
    // extractor.videos = 'default' is found before instagram.videos = true.
    const cfg = new ConfigManager({
      extractor: {
        instagram: {
          post: { videos: false },
          videos: true,
        },
        videos: 'default',
      },
    })

    const result = cfg.interpolate(
      ['extractor', 'instagram', 'post'],
      'videos',
    )
    expect(result).toBe('default')
  })

  it.each([
    [
      'grandparent level',
      {
        extractor: { videos: 'grandparent' },
      },
      'grandparent',
    ],
    [
      'instagram level',
      {
        extractor: {
          instagram: { videos: true },
        },
      },
      true,
    ],
  ])('finds key at %s', (_, data, expected) => {
    const cfg = new ConfigManager(data)
    expect(cfg.interpolate(['extractor', 'instagram', 'post'], 'videos')).toBe(expected)
  })

  it('returns default when key not found at any level', () => {
    const cfg = new ConfigManager({})

    const result = cfg.interpolate(
      ['extractor', 'instagram', 'post'],
      'videos',
      'fallback',
    )
    expect(result).toBe('fallback')
  })

  it('returns undefined when not found and no default', () => {
    const cfg = new ConfigManager({})

    const result = cfg.interpolate(
      ['extractor', 'instagram', 'post'],
      'videos',
    )
    expect(result).toBeUndefined()
  })
})
