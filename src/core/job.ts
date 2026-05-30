/**
 * Job dispatch system.
 *
 * ``Job`` is the abstract base — it loops over ``Extractor.items()`` and
 * routes each message to ``handleDirectory``, ``handleUrl``, or
 * ``handleQueue``.
 */

import type { DirectoryMsg, QueueMsg, UrlMsg } from '../types'
import type { Extractor } from './extractor'

export abstract class Job {
  readonly extractor: Extractor
  status = 0

  constructor(extractor: Extractor) {
    this.extractor = extractor
  }

  /** Main entry point. Dispatches every yielded message. */
  async run(): Promise<number> {
    this.extractor.log.info(
      `Starting ${this.extractor.category}/${this.extractor.subcategory} — ${this.extractor.url}`,
    )
    await this.extractor.initialize()

    for await (const msg of this.extractor) {
      switch (msg.type) {
        case 'directory':
          await this.handleDirectory(msg)
          break
        case 'url':
          await this.handleUrl(msg)
          break
        case 'queue':
          await this.handleQueue(msg)
          break
      }
    }

    this._report()
    return this.status
  }

  /** Override in subclasses to print a summary. */
  protected _report(): void {}

  abstract handleDirectory(msg: DirectoryMsg): Promise<void>
  abstract handleUrl(msg: UrlMsg): Promise<void>
  abstract handleQueue(msg: QueueMsg): Promise<void>
}
