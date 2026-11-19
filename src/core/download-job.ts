/**
 * DownloadJob — concrete Job that downloads files via Storage.
 */

import type { DirectoryMsg, Metadata, QueueMsg, UrlMsg } from '../types'
import type { Extractor } from './extractor'
import { formatBytes } from './format'
import { Job } from './job'

type ArchiveMap = Map<string, Set<string>>

export class DownloadJob extends Job {
  /** Base output directory (prepended to all paths). */
  basePath: string = ''

  /** Current target directory metadata (set by directory messages). */
  private _currentDir: Metadata = {}

  /** In-memory archive keyed by archive format. */
  readonly archive: ArchiveMap = new Map()

  private readonly _archiveFmts: Map<string, string> = new Map()

  private _postCount = 0
  private _fileCount = 0
  private _downloadedBytes = 0
  private _skippedCount = 0

  /** Download counters for the current job tree. */
  get stats(): { posts: number, files: number, bytes: number, skipped: number } {
    return {
      posts: this._postCount,
      files: this._fileCount,
      bytes: this._downloadedBytes,
      skipped: this._skippedCount,
    }
  }

  registerArchive(category: string, format: string): void {
    this._archiveFmts.set(category, format)
  }

  private _interp(fmt: string, meta: Metadata): string {
    return fmt.replace(/\{(\w+)\}/g, (_, key) => {
      const v = meta[key]
      return v == null
        ? ''
        : String(v)
    })
  }

  private _isArchived(meta: Metadata): boolean {
    const cat = (meta.category ?? this.extractor.category) as string
    const fmt = this._archiveFmts.get(cat) ?? '{media_id}'
    const key = this._interp(fmt, meta)
    return !!this.archive.get(cat)?.has(key)
  }

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

  async handleDirectory(msg: DirectoryMsg): Promise<void> {
    this._currentDir = { ...msg.metadata }
    this._postCount++

    const dirPath = this.basePath
      ? `${this.basePath}/${this._buildDirPath(msg.metadata)}`
      : this._buildDirPath(msg.metadata)
    await this.extractor.storage.mkdir(dirPath)
    this.extractor.log.info(
      `#${this._postCount} ${msg.metadata.username ?? '?'}/${msg.metadata.post_shortcode ?? '?'} → ${dirPath}/`,
    )
  }

  async handleUrl(msg: UrlMsg): Promise<void> {
    const meta: Metadata = {
      ...this._currentDir,
      ...msg.metadata,
    }

    if (this._isArchived(meta)) {
      this._skippedCount++
      return
    }

    const filename = this._buildFilename(meta)
    const dirPath = this.basePath
      ? `${this.basePath}/${this._buildDirPath(meta)}`
      : this._buildDirPath(meta)
    const fullPath = `${dirPath}/${filename}`

    try {
      const resp = await this.extractor.http.request({
        url: msg.url,
        method: 'GET',
        responseType: 'arraybuffer',
      })

      let data: Uint8Array | string
      if (resp.data instanceof Uint8Array) {
        data = resp.data
      }
      else if (resp.data instanceof ArrayBuffer) {
        data = new Uint8Array(resp.data)
      }
      else if (typeof resp.data === 'string') {
        data = resp.data
      }
      else {
        data = JSON.stringify(resp.data)
      }
      await this.extractor.storage.write(fullPath, data)

      this._fileCount++
      const size = data instanceof Uint8Array
        ? data.byteLength
        : data.length
      this._downloadedBytes += size
      this.extractor.log.info(`  └─ ${filename}  (${formatBytes(size)})`)

      this._archive(meta)
    }
    catch (err) {
      this.extractor.log.error(`Failed to download ${filename}: ${String(err)}`)
      this.status |= 4
    }
  }

  async handleQueue(msg: QueueMsg): Promise<void> {
    const meta = {
      ...this._currentDir,
      ...msg.metadata,
    }
    const extrClass = meta._extractor
    if (!extrClass || typeof extrClass !== 'function')
      return

    const cls = extrClass as unknown as {
      pattern: RegExp
      subcategory: string
      new (opts: Record<string, unknown>): Extractor
    }

    // URLs from user extractor dispatch may have trailing slashes that
    // the sub-extractor pattern doesn't expect (e.g. /info/ vs /info).
    const match = cls.pattern.exec(msg.url)
      ?? cls.pattern.exec(msg.url.replace(/\/$/, ''))
    if (!match)
      return

    const parentExtr = this.extractor
    const parentState = parentExtr as unknown as {
      csrfToken?: { value: string }
      wwwClaim?: { value: string }
      lsdToken?: { value: string }
      requestInterval?: [number, number]
    }

    const state = parentState.csrfToken
      ? {
          csrfToken: parentState.csrfToken,
          wwwClaim: parentState.wwwClaim,
          lsdToken: parentState.lsdToken,
        }
      : undefined

    const childExtr = Reflect.construct(cls, [
      {
        url: msg.url,
        match,
        config: parentExtr.config,
        http: parentExtr.http,
        storage: parentExtr.storage,
        log: parentExtr.log,
        state,
        requestInterval: parentState.requestInterval,
      },
    ])

    const childJob = new DownloadJob(childExtr)
    childJob.basePath = (this as unknown as DownloadJob).basePath
    ;(childJob as unknown as { _currentDir: Metadata })._currentDir = meta

    for (const [cat, set] of this.archive) {
      childJob.archive.set(cat, new Set(set))
    }
    for (const [cat, fmt] of this._archiveFmts) {
      childJob._archiveFmts.set(cat, fmt)
    }

    const childStatus = await childJob.run()
    this.status |= childStatus

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

  protected override _report(): void {
    const log = this.extractor.log
    log.info(
      `Done — ${this._postCount} post(s), ${this._fileCount} file(s) downloaded (${formatBytes(this._downloadedBytes)})`,
    )
    if (this._skippedCount > 0) {
      log.info(`  ${this._skippedCount} file(s) skipped (already archived)`)
    }
  }

  private _buildDirPath(meta: Metadata): string {
    const cat = meta.category ?? this.extractor.category
    const user = meta.username ?? '_'
    return `${cat}/${user}`
  }

  private _buildFilename(meta: Metadata): string {
    const mid = meta.media_id ?? '0'
    const ext = meta.extension ?? 'jpg'
    const num = meta.num
      ? `_${meta.num}`
      : ''
    return `${mid}${num}.${ext}`
  }
}
