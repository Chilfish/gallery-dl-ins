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

function formatBytes(bytes: number): string {
  if (bytes === 0)
    return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const val = bytes / 1024 ** i
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

// ── ANSI helpers ──

const BOLD = '\x1B[1m'
const DIM = '\x1B[2m'
const CYAN = '\x1B[36m'
const GREEN = '\x1B[32m'
const YELLOW = '\x1B[33m'
const RESET = '\x1B[0m'

function b(s: string): string {
  return `${BOLD}${s}${RESET}`
}
function dim(s: string): string {
  return `${DIM}${s}${RESET}`
}
function c(s: string): string {
  return `${CYAN}${s}${RESET}`
}
function g(s: string): string {
  return `${GREEN}${s}${RESET}`
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length)
}

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

/** An in-memory archive: category → Set<archive-key>. */
type ArchiveMap = Map<string, Set<string>>

export class DownloadJob extends Job {
  /** Base output directory (prepended to all paths). */
  basePath: string = ''

  /** Current target directory metadata (set by directory messages). */
  private _currentDir: Metadata = {}

  /** In-memory archive keyed by archive format. */
  readonly archive: ArchiveMap = new Map()

  /**
   * Registry of per-category "archive formats" — the key is formed
   * by interpolating this format string over the metadata.
   */
  private readonly _archiveFmts: Map<string, string> = new Map()

  // ── Stats ──
  private _postCount = 0
  private _fileCount = 0
  private _downloadedBytes = 0
  private _skippedCount = 0

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

  /** Handlers */

  async handleDirectory(msg: DirectoryMsg): Promise<void> {
    this._currentDir = { ...msg.metadata }
    this._postCount++

    // Ensure directory exists
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

    // Archive check
    if (this._isArchived(meta)) {
      this._skippedCount++
      return
    }

    // Build output path
    const filename = this._buildFilename(meta)
    const dirPath = this.basePath
      ? `${this.basePath}/${this._buildDirPath(meta)}`
      : this._buildDirPath(meta)
    const fullPath = `${dirPath}/${filename}`

    try {
      // Fetch as binary (images, videos are not text)
      const resp = await this.extractor.http.request({
        url: msg.url,
        method: 'GET',
        responseType: 'arraybuffer',
      })

      // Convert to Uint8Array for Storage.write
      // Native fetch returns Node.js Buffer (extends Uint8Array) for arraybuffer
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
      const size = data instanceof Uint8Array ? data.byteLength : data.length
      this._downloadedBytes += size
      this.extractor.log.info(
        `  └─ ${filename}  (${formatBytes(size)})`,
      )

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

    // The _extractor in metadata is a static class reference
    // Use its pattern to match the URL, then construct with parent deps
    const cls = extrClass as unknown as {
      pattern: RegExp
      subcategory: string
      new (opts: Record<string, unknown>): Extractor
    }

    const match = cls.pattern.exec(msg.url)
    if (!match)
      return

    // Construct child extractor with parent's http/storage/log/config
    const parentExtr = this.extractor
    const childExtr = Reflect.construct(cls, [{
      url: msg.url,
      match,
      config: parentExtr.config,
      http: parentExtr.http,
      storage: parentExtr.storage,
      log: parentExtr.log,
    }])

    const childJob = new DownloadJob(childExtr)
    childJob.basePath = (this as any).basePath

    // Propagate current directory metadata
    ;(childJob as any)._currentDir = meta

    // Propagate archive state
    for (const [cat, set] of (this as any).archive) {
      ;(childJob as any).archive.set(cat, new Set(set))
    }
    for (const [cat, fmt] of (this as any)._archiveFmts) {
      ;(childJob as any)._archiveFmts.set(cat, fmt)
    }

    const childStatus = await childJob.run()
    this.status |= childStatus

    // Merge back new archive entries
    for (const [cat, set] of (childJob as any).archive) {
      const mine = (this as any).archive.get(cat)
      if (mine) {
        for (const k of set as Set<string>) (mine as Set<string>).add(k)
      }
      else {
        ;(this as any).archive.set(cat, set)
      }
    }
  }

  /** Report */

  protected override _report(): void {
    const log = this.extractor.log
    log.info(
      `Done — ${this._postCount} post(s), ${this._fileCount} file(s) downloaded (${formatBytes(this._downloadedBytes)})`,
    )
    if (this._skippedCount > 0) {
      log.info(`  ${this._skippedCount} file(s) skipped (already archived)`)
    }
  }

  /** Path builders */

  private _buildDirPath(meta: Metadata): string {
    const cat = meta.category ?? this.extractor.category
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

/** Job that prints structured post info to the terminal instead of downloading. */

interface _FileLine {
  num: number
  filename: string
  width: number
  height: number
  videoUrl: string | null
  audioUrl: string | null
}

export class PrintJob extends Job {
  private _currentDir: Metadata = {}
  private _files: _FileLine[] = []
  private _postCount = 0
  private _fileCount = 0
  private _width: number

  constructor(extractor: Extractor) {
    super(extractor)
    this._width = Math.min(process.stdout.columns ?? 80, 100)
  }

  async handleDirectory(msg: DirectoryMsg): Promise<void> {
    if (this._postCount > 0) {
      this._flushPost()
    }
    this._currentDir = { ...msg.metadata }
    this._postCount++
    this._files = []
  }

  async handleUrl(msg: UrlMsg): Promise<void> {
    const meta = { ...this._currentDir, ...msg.metadata }
    this._fileCount++
    const ext = (meta.extension as string) ?? 'jpg'
    const mid = meta.media_id ?? '?'
    this._files.push({
      num: (meta.num as number) ?? this._files.length + 1,
      filename: `${mid}.${ext}`,
      width: (meta.width as number) ?? 0,
      height: (meta.height as number) ?? 0,
      videoUrl: (meta.video_url as string) ?? null,
      audioUrl: (meta.audio_url as string) ?? null,
    })
  }

  async handleQueue(msg: QueueMsg): Promise<void> {
    if (this._files.length > 0 || this._postCount > 0) {
      this._flushPost()
    }
    this._postCount = 0
    this._files = []

    const meta = { ...this._currentDir, ...msg.metadata }
    const extrClass = meta._extractor
    if (!extrClass || typeof extrClass !== 'object')
      return

    const cls = extrClass as unknown as {
      pattern: RegExp
      subcategory: string
      new (opts: Record<string, unknown>): Extractor
    }

    const match = cls.pattern.exec(msg.url)
    if (!match)
      return

    const parentExtr = this.extractor
    const childExtr = Reflect.construct(cls, [{
      url: msg.url,
      match,
      config: parentExtr.config,
      http: parentExtr.http,
      storage: parentExtr.storage,
      log: parentExtr.log,
    }])

    const childJob = new PrintJob(childExtr)
    const childStatus = await childJob.run()
    this.status |= childStatus

    // Merge stats
    this._postCount += childJob._postCount
    this._fileCount += childJob._fileCount
  }

  /** Output */

  private _flushPost(): void {
    const m = this._currentDir
    if (Object.keys(m).length === 0)
      return

    const w = this._width
    const labelW = 14

    // Header
    const shortcode = (m.post_shortcode as string) ?? '?'
    const header = ` Post #${this._postCount}: ${shortcode} `
    const padTotal = w - 2 - header.length
    const padL = Math.floor(padTotal / 2)
    const padR = padTotal - padL
    process.stdout.write(`\n${dim('┌')}${'─'.repeat(padL)}${b(header)}${'─'.repeat(padR)}${dim('┐')}\n`)

    const row = (label: string, value: string, color?: ((s: string) => string) | string): void => {
      const colored = typeof color === 'function' ? color(value) : color ? `${color}${value}${RESET}` : value
      process.stdout.write(` ${dim('│')} ${c(pad(label, labelW))} ${colored}\n`)
    }

    // Meta
    const username = (m.username as string) ?? '?'
    const fullname = (m.fullname as string) ?? ''
    const author = fullname ? `${username} (${fullname})` : username
    row('Author:', author, g)

    const date = (m.date as string) ?? (m.post_date as string) ?? '?'
    row('Date:', date)

    const likes = typeof m.likes === 'number' ? m.likes.toLocaleString() : '?'
    const liked = m.liked ? 'yes' : 'no'
    row('Likes:', `${likes}  |  Liked: ${liked}`)

    const ptype = (m.type as string) ?? '?'
    row('Type:', `${ptype}  (${this._files.length} files)`)

    const postUrl = (m.post_url as string) ?? '?'
    row('URL:', postUrl)

    // Description
    const desc = (m.description as string) ?? ''
    if (desc) {
      process.stdout.write(` ${dim('│')}\n`)
      process.stdout.write(` ${dim('│')} ${b('Description:')}\n`)
      const lines = desc.split('\n')
      for (const line of lines) {
        const wrapped = this._wrap(line, w - 8)
        for (const wl of wrapped) {
          process.stdout.write(` ${dim('│')}   ${dim(wl)}\n`)
        }
      }
    }

    // Tags
    const tags = m.tags as string[] | undefined
    if (tags && tags.length > 0) {
      process.stdout.write(` ${dim('│')}\n`)
      process.stdout.write(` ${dim('│')} ${b('Tags:')} ${dim(tags.map(t => `#${t}`).join('  '))}\n`)
    }

    // Location
    const locName = (m.location_slug as string) ?? ''
    const locId = (m.location_id as string) ?? ''
    if (locName || locId) {
      const loc = locId ? `${locName} (ID: ${locId})` : locName
      row('Location:', loc)
    }

    // Coauthors
    const coauthors = m.coauthors as Array<{ username: string, full_name?: string }> | undefined
    if (coauthors && coauthors.length > 0) {
      row('Co-authors:', coauthors.map(c => c.full_name ? `${c.username} (${c.full_name})` : c.username).join(', '))
    }

    // Pinned
    const pinned = m.pinned as string[] | undefined
    if (pinned && pinned.length > 0) {
      row('Pinned:', pinned.join(', '))
    }

    // Expires (stories)
    const expires = m.expires as string | undefined
    if (expires) {
      row('Expires:', expires, YELLOW)
    }

    // Highlight title
    const hlTitle = m.highlight_title as string | undefined
    if (hlTitle) {
      row('Highlight:', hlTitle)
    }

    // Tagged owner
    const taggedUser = (m.tagged_username as string) ?? ''
    if (taggedUser) {
      const taggedFull = (m.tagged_full_name as string) ?? ''
      const display = taggedFull ? `${taggedUser} (${taggedFull})` : taggedUser
      row('Tagged by:', display)
    }

    // Media files
    if (this._files.length > 0) {
      process.stdout.write(` ${dim('│')}\n`)
      process.stdout.write(` ${dim('│')} ${b(`Media (${this._files.length} files):`)}\n`)

      const maxNumW = String(this._files.length).length
      const maxFileW = Math.max(...this._files.map(f => f.filename.length))
      const dimW = Math.min(maxFileW, 40)

      for (const f of this._files) {
        const numStr = `[${String(f.num).padStart(maxNumW)}]`
        const dimStr = f.filename.length > 40 ? `${f.filename.slice(0, 37)}...` : pad(f.filename, dimW)
        const res = f.width ? `${f.width}x${f.height}` : '?x?'
        const badges: string[] = []
        if (f.videoUrl)
          badges.push('video')
        if (f.audioUrl)
          badges.push('audio')

        let line = ` ${dim('│')}   ${g(numStr)} ${dimStr}  ${res}`
        if (badges.length > 0) {
          line += `  ${YELLOW}(${badges.join('+')})${RESET}`
        }
        process.stdout.write(`${line}\n`)
      }
    }

    // Footer
    process.stdout.write(` ${dim('└')}${'─'.repeat(w - 2)}${dim('┘')}\n`)
  }

  private _wrap(text: string, maxLen: number): string[] {
    if (text.length <= maxLen)
      return [text]
    const lines: string[] = []
    let remaining = text
    while (remaining.length > maxLen) {
      let cut = maxLen
      while (cut > 0 && remaining[cut] !== ' ')
        cut--
      if (cut === 0)
        cut = maxLen
      lines.push(remaining.slice(0, cut).trimEnd())
      remaining = remaining.slice(cut).trimStart()
    }
    if (remaining)
      lines.push(remaining)
    return lines
  }

  protected override _report(): void {
    // Flush last post
    this._flushPost()

    process.stdout.write(`\n${dim('──')} ${b('Summary')} ${dim('───')}\n`)
    process.stdout.write(`  Posts: ${g(String(this._postCount))}\n`)
    process.stdout.write(`  Files: ${g(String(this._fileCount))}\n`)
    process.stdout.write(`\n`)
  }
}
