/**
 * Job dispatch system.
 *
 * ``Job`` is the abstract base — it loops over ``Extractor.items()`` and
 * routes each message to ``handleDirectory``, ``handleUrl``, or
 * ``handleQueue``.
 *
 * ``DownloadJob`` is a concrete implementation that downloads files via
 * the ``Storage`` abstraction and maintains an in-memory download archive.
 */

import type {
  DirectoryMsg,
  Metadata,
  QueueMsg,
  UrlMsg,
} from '../types'
import type { Extractor } from './extractor'

// ---------------------------------------------------------------------------
// Job (abstract)
// ---------------------------------------------------------------------------

export abstract class Job {
  readonly extractor: Extractor
  status = 0

  constructor(extractor: Extractor) {
    this.extractor = extractor
  }

  /**
   * Main entry point.  Calls ``extractor[Symbol.asyncIterator]()`` and
   * dispatches every yielded message.
   */
  async run(): Promise<number> {
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

    return this.status
  }

  abstract handleDirectory(msg: DirectoryMsg): Promise<void>
  abstract handleUrl(msg: UrlMsg): Promise<void>
  abstract handleQueue(msg: QueueMsg): Promise<void>
}

// ---------------------------------------------------------------------------
// DownloadJob
// ---------------------------------------------------------------------------

/** An in-memory archive: category → Set<archive-key>. */
type ArchiveMap = Map<string, Set<string>>

export class DownloadJob extends Job {
  /** Current target directory metadata (set by directory messages). */
  private _currentDir: Metadata = {}

  /** In-memory archive keyed by archive format. */
  readonly archive: ArchiveMap = new Map()

  /**
   * Registry of per-category "archive formats" — the key is formed
   * by interpolating this format string over the metadata.
   */
  private readonly _archiveFmts: Map<string, string> = new Map()

  registerArchive(category: string, format: string): void {
    this._archiveFmts.set(category, format)
  }

  /** Simple format-string interpolation for archive keys. */
  private _interp(fmt: string, meta: Metadata): string {
    return fmt.replace(/\{(\w+)\}/g, (_, key) => {
      const v = meta[key]
      return v == null ? '' : String(v)
    })
  }

  /** Check whether this URL has already been downloaded (and skip). */
  private _isArchived(meta: Metadata): boolean {
    const cat = (meta.category ?? this.extractor.category) as string
    const fmt = this._archiveFmts.get(cat) ?? '{media_id}'
    const key = this._interp(fmt, meta)
    const set = this.archive.get(cat)
    if (set && set.has(key))
      return true
    return false
  }

  /** Mark a post/media as archived. */
  private _archive(meta: Metadata): void {
    const cat = (meta.category ?? this.extractor.category) as string
    const fmt = this._archiveFmts.get(cat) ?? '{media_id}'
    const key = this._interp(fmt, meta)
    let set = this.archive.get(cat)
    if (!set) {
      set = new Set()
      this.archive.set(cat, set)
    }
    set.add(key)
  }

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  async handleDirectory(msg: DirectoryMsg): Promise<void> {
    this._currentDir = { ...msg.metadata }

    // Ensure directory exists
    const dirPath = this._buildDirPath(msg.metadata)
    if (dirPath) {
      await this.extractor.storage.mkdir(dirPath)
    }
  }

  async handleUrl(msg: UrlMsg): Promise<void> {
    const meta: Metadata = {
      ...this._currentDir,
      ...msg.metadata,
    }

    // Archive check
    if (this._isArchived(meta))
      return

    // Build output path
    const filename = this._buildFilename(meta)
    const dirPath = this._buildDirPath(meta)
    const fullPath = dirPath ? `${dirPath}/${filename}` : filename

    try {
      // Fetch the content
      const resp = await this.extractor.http.request({
        url: msg.url,
        method: 'GET',
      })

      // Write via Storage abstraction
      const data
        = resp.data instanceof Uint8Array
          ? resp.data
          : typeof resp.data === 'string'
            ? resp.data
            : JSON.stringify(resp.data)
      await this.extractor.storage.write(fullPath, data)

      this._archive(meta)
    }
    catch (err) {
      this.extractor.log.error(
        `Failed to download ${filename}: ${String(err)}`,
      )
      this.status |= 4
    }
  }

  async handleQueue(msg: QueueMsg): Promise<void> {
    const meta = { ...this._currentDir, ...msg.metadata }
    const extrClass = meta._extractor
    if (!extrClass || typeof extrClass !== 'object')
      return
    const cls = extrClass as { fromURL: (url: string) => Extractor | null }

    const childExtr = cls.fromURL(msg.url)
    if (!childExtr)
      return

    const childJob = new DownloadJob(childExtr)
    childJob._currentDir = meta
    // Propagate archive
    for (const [cat, set] of this.archive) {
      childJob.archive.set(cat, new Set(set))
    }
    for (const [cat, fmt] of this._archiveFmts) {
      childJob._archiveFmts.set(cat, fmt)
    }

    const childStatus = await childJob.run()
    this.status |= childStatus

    // Merge back any new archive entries
    for (const [cat, set] of childJob.archive) {
      const mine = this.archive.get(cat)
      if (mine) {
        for (const k of set) mine.add(k)
      }
      else {
        this.archive.set(cat, set)
      }
    }
  }

  // -----------------------------------------------------------------------
  // Path builders
  // -----------------------------------------------------------------------

  private _buildDirPath(meta: Metadata): string {
    const cat = meta.category ?? this.extractor.category
    const sub = meta.subcategory ?? this.extractor.subcategory
    const user = meta.username ?? '_'
    return `${cat}/${user}`
  }

  private _buildFilename(meta: Metadata): string {
    const mid = meta.media_id ?? '0'
    const ext = meta.extension ?? 'jpg'
    const num = meta.num ? `_${meta.num}` : ''
    return `${mid}${num}.${ext}`
  }
}
