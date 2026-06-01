/**
 * PrintJob — concrete Job that prints structured post info to the terminal
 * instead of downloading. Used by ``gdl-instagram --print``.
 */

import type { DirectoryMsg, Metadata, QueueMsg, UrlMsg } from '../types'
import type { Extractor } from './extractor'
import { _RESET, _YELLOW, b, c, dim, g, pad } from './format'
import { Job } from './job'

interface FileLine {
  num: number
  filename: string
  width: number
  height: number
  videoUrl: string | null
  audioUrl: string | null
  audioTitle?: string
  audioArtist?: string
  audioDuration?: number
  audioHasLyrics?: boolean
  audioIsExplicit?: boolean
  coverArtworkUri?: string
  storyLinkUrl?: string
  storyLinkDisplay?: string
  storyLinkTitle?: string
  storyLinkType?: string
  musicAttribution?: string
}

export class PrintJob extends Job {
  private _currentDir: Metadata = {}
  private _files: FileLine[] = []
  private _postCount = 0
  private _fileCount = 0
  private _width: number

  constructor(extractor: Extractor) {
    super(extractor)
    this._width = Math.min(process.stdout.columns ?? 80, 100)
  }

  async handleDirectory(msg: DirectoryMsg): Promise<void> {
    if (this._postCount > 0)
      this._flushPost()
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
      audioTitle: (meta.audio_title as string) ?? undefined,
      audioArtist: (meta.audio_artist as string) ?? undefined,
      audioDuration: (meta.audio_duration as number) ?? undefined,
      audioHasLyrics: (meta.audio_has_lyrics as boolean) ?? undefined,
      audioIsExplicit: (meta.audio_is_explicit as boolean) ?? undefined,
      coverArtworkUri: (meta.audio_cover_artwork_uri as string) ?? (meta.audio_cover_artwork_thumbnail_uri as string) ?? undefined,
      storyLinkUrl: (meta.story_link_url as string) ?? undefined,
      storyLinkDisplay: (meta.story_link_display as string) ?? undefined,
      storyLinkTitle: (meta.story_link_title as string) ?? undefined,
      storyLinkType: (meta.story_link_type as string) ?? undefined,
      musicAttribution: (meta.music_attribution as string) ?? undefined,
    })
  }

  async handleQueue(msg: QueueMsg): Promise<void> {
    if (this._files.length > 0 || this._postCount > 0)
      this._flushPost()
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

    this._postCount += childJob._postCount
    this._fileCount += childJob._fileCount
  }

  private _flushPost(): void {
    const m = this._currentDir
    if (Object.keys(m).length === 0)
      return

    const w = this._width
    const labelW = 14

    const shortcode = (m.post_shortcode as string) ?? '?'
    const header = ` Post #${this._postCount}: ${shortcode} `
    const padTotal = w - 2 - header.length
    const padL = Math.floor(padTotal / 2)
    const padR = padTotal - padL
    process.stdout.write(`\n${dim('┌')}${'─'.repeat(padL)}${b(header)}${'─'.repeat(padR)}${dim('┐')}\n`)

    const row = (label: string, value: string, color?: ((s: string) => string) | string): void => {
      const colored = typeof color === 'function' ? color(value) : color ? `${color}${value}${_RESET}` : value
      process.stdout.write(` ${dim('│')} ${c(pad(label, labelW))} ${colored}\n`)
    }

    const username = (m.username as string) ?? '?'
    const fullname = (m.fullname as string) ?? ''
    const author = fullname ? `${username} (${fullname})` : username
    row('Author:', author, g)

    const date = (m.date as string) ?? (m.post_date as string) ?? '?'
    row('Date:', date)

    const likes = typeof m.likes === 'number' ? m.likes.toLocaleString() : '?'
    row('Likes:', `${likes}  |  Liked: ${m.liked ? 'yes' : 'no'}`)

    const ptype = (m.type as string) ?? '?'
    row('Type:', `${ptype}  (${this._files.length} files)`)

    const postUrl = (m.post_url as string) ?? '?'
    row('URL:', postUrl)

    const desc = (m.description as string) ?? ''
    if (desc) {
      process.stdout.write(` ${dim('│')}\n`)
      process.stdout.write(` ${dim('│')} ${b('Description:')}\n`)
      for (const line of desc.split('\n')) {
        for (const wl of this._wrap(line, w - 8)) {
          process.stdout.write(` ${dim('│')}   ${dim(wl)}\n`)
        }
      }
    }

    const tags = m.tags as string[] | undefined
    if (tags && tags.length > 0) {
      process.stdout.write(` ${dim('│')}\n`)
      process.stdout.write(` ${dim('│')} ${b('Tags:')} ${dim(tags.map(t => `#${t}`).join('  '))}\n`)
    }

    const locName = (m.location_slug as string) ?? ''
    const locId = (m.location_id as string) ?? ''
    if (locName || locId) {
      row('Location:', locId ? `${locName} (ID: ${locId})` : locName)
    }

    const coauthors = m.coauthors as Array<{ username: string, full_name?: string }> | undefined
    if (coauthors && coauthors.length > 0) {
      row('Co-authors:', coauthors.map(c => c.full_name ? `${c.username} (${c.full_name})` : c.username).join(', '))
    }

    const pinned = m.pinned as string[] | undefined
    if (pinned && pinned.length > 0) {
      row('Pinned:', pinned.join(', '))
    }

    const expires = m.expires as string | undefined
    if (expires)
      row('Expires:', expires, _YELLOW)

    const hlTitle = m.highlight_title as string | undefined
    if (hlTitle)
      row('Highlight:', hlTitle)

    const taggedUser = (m.tagged_username as string) ?? ''
    if (taggedUser) {
      const taggedFull = (m.tagged_full_name as string) ?? ''
      row('Tagged by:', taggedFull ? `${taggedUser} (${taggedFull})` : taggedUser)
    }

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
        if (badges.length > 0)
          line += `  ${_YELLOW}(${badges.join('+')})${_RESET}`
        process.stdout.write(`${line}\n`)
      }
    }

    // Story link stickers
    const linkFiles = this._files.filter(f => f.storyLinkUrl)
    if (linkFiles.length > 0) {
      process.stdout.write(` ${dim('│')}\n`)
      process.stdout.write(` ${dim('│')} ${b('Link:')}\n`)
      for (const lf of linkFiles) {
        if (lf.storyLinkDisplay) {
          process.stdout.write(` ${dim('│')}   ${g('🔗')} ${lf.storyLinkDisplay}\n`)
        }
        if (lf.storyLinkTitle && lf.storyLinkTitle !== 'Visit Link') {
          process.stdout.write(` ${dim('│')}   ${dim('Title:')} ${lf.storyLinkTitle}\n`)
        }
        if (lf.storyLinkType) {
          process.stdout.write(` ${dim('│')}   ${dim('Type:')} ${lf.storyLinkType}\n`)
        }
      }
    }

    const audioFiles = this._files.filter(f => f.audioUrl)
    if (audioFiles.length > 0) {
      process.stdout.write(` ${dim('│')}\n`)
      process.stdout.write(` ${dim('│')} ${b('Music:')}\n`)
      for (const af of audioFiles) {
        if (af.audioTitle) {
          const title = af.audioArtist ? `${af.audioTitle} — ${af.audioArtist}` : af.audioTitle
          process.stdout.write(` ${dim('│')}   ${g('♪')} ${title}\n`)
        }
        if (af.musicAttribution) {
          process.stdout.write(` ${dim('│')}   ${dim('via:')} ${af.musicAttribution}\n`)
        }
        if (af.audioDuration) {
          const mins = Math.floor(af.audioDuration / 60)
          const secs = Math.round(af.audioDuration % 60)
          const dur = `${mins}:${String(secs).padStart(2, '0')}`
          const badges: string[] = [dur]
          if (af.audioHasLyrics)
            badges.push('lyrics')
          if (af.audioIsExplicit)
            badges.push(`${_YELLOW}explicit${_RESET}`)
          process.stdout.write(` ${dim('│')}   ${dim(badges.join(' · '))}\n`)
        }
        if (af.coverArtworkUri) {
          process.stdout.write(` ${dim('│')}   ${dim('Art:')} ${dim(`${af.coverArtworkUri.slice(0, 60)}…`)}\n`)
        }
      }
    }

    process.stdout.write(` ${dim('└')}${'─'.repeat(w - 2)}${dim('┘')}\n`)
  }

  private _wrap(text: string, maxLen: number): string[] {
    if (text.length <= maxLen)
      return [text]
    const lines: string[] = []
    let remaining = text
    while (remaining.length > maxLen) {
      let cut = maxLen
      while (cut > 0 && remaining[cut] !== ' ') cut--
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
    this._flushPost()
    process.stdout.write(`\n${dim('──')} ${b('Summary')} ${dim('───')}\n`)
    process.stdout.write(`  Posts: ${g(String(this._postCount))}\n`)
    process.stdout.write(`  Files: ${g(String(this._fileCount))}\n`)
    process.stdout.write(`\n`)
  }
}
