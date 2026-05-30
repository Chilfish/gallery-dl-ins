/**
 * Extractor registry — breaks the circular dependency between UserExtractor
 * (which dispatches to sub-extractors) and the sub-extractors themselves.
 *
 * Each extractor file calls ``register()`` as a module side-effect.
 * UserExtractor reads the registry at runtime (not import time).
 */

import type { ExtractorClass } from '../../types'

const _registry = new Map<string, ExtractorClass>()

export function register(subcategory: string, cls: ExtractorClass): void {
  _registry.set(subcategory, cls)
}

export function get(subcategory: string): ExtractorClass | undefined {
  return _registry.get(subcategory)
}
