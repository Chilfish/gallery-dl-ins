import type { InstagramCarouselItem, InstagramPost } from '../../src/instagram/types'
import { describe, expect, it } from 'vitest'
import { bestCandidate, isDownscaled, needsUpgrade, upgradeMedia } from '../../src/instagram/media-upgrade'

function media(overrides: Partial<InstagramCarouselItem> = {}): InstagramCarouselItem {
  return {
    pk: '1',
    image_versions2: {
      candidates: [
        { url: 'https://cdn/1080.jpg', width: 1080, height: 708 },
        { url: 'https://cdn/366.jpg', width: 366, height: 240 },
      ],
    },
    ...overrides,
  } as InstagramCarouselItem
}

function post(overrides: Partial<InstagramPost> = {}): InstagramPost {
  return {
    pk: '1',
    code: 'CxAbCdEfGh',
    caption: null,
    taken_at: 1_700_000_000,
    user: { pk: '9', username: 'u', full_name: 'U' },
    image_versions2: {
      candidates: [
        { url: 'https://cdn/1080.jpg', width: 1080, height: 708 },
        { url: 'https://cdn/366.jpg', width: 366, height: 240 },
      ],
    },
    ...overrides,
  } as InstagramPost
}

describe('bestCandidate', () => {
  it('picks the largest candidate', () => {
    const best = bestCandidate([
      { url: 'a', width: 1080, height: 708 },
      { url: 'b', width: 1440, height: 944 },
      { url: 'c', width: 720, height: 472 },
    ])
    expect(best?.url).toBe('b')
  })

  it('keeps the original frame instead of a larger square crop', () => {
    const best = bestCandidate(
      [
        { url: 'wide', width: 1440, height: 944 },
        { url: 'square', width: 1080, height: 1080 },
      ],
      1440,
      944,
    )
    // 1080x1080 has more pixels, but it is a crop — the ratio filter wins.
    expect(best?.url).toBe('wide')
  })

  it('ignores sizeless candidates when sized ones exist', () => {
    const best = bestCandidate([
      { url: 'sizeless' } as { url: string, width: number, height: number },
      { url: 'sized', width: 640, height: 420 },
    ])
    expect(best?.url).toBe('sized')
  })

  it('falls back to the first candidate when nothing is sized', () => {
    const best = bestCandidate([
      { url: 'sizeless' } as { url: string, width: number, height: number },
    ])
    expect(best?.url).toBe('sizeless')
  })
})

describe('isDownscaled', () => {
  it('detects a candidate ladder below the original size', () => {
    expect(isDownscaled(media({ original_width: 1440, original_height: 944 }))).toBe(true)
  })

  it('reports false when a candidate already matches the original size', () => {
    const full = media({
      original_width: 1440,
      original_height: 944,
      image_versions2: {
        candidates: [
          { url: 'https://cdn/1440.jpg', width: 1440, height: 944 },
          { url: 'https://cdn/1080.jpg', width: 1080, height: 708 },
        ],
      },
    })
    expect(isDownscaled(full)).toBe(false)
  })

  it('reports false when the original size is unknown', () => {
    expect(isDownscaled(media())).toBe(false)
  })

  it('skips videos because covers are always smaller than the frame', () => {
    expect(isDownscaled(media({
      media_type: 2,
      original_width: 1080,
      original_height: 1920,
    }))).toBe(false)
  })

  it('checks carousel children through needsUpgrade', () => {
    const carousel = post({
      media_type: 8,
      original_width: 1440,
      original_height: 1654,
      carousel_media: [
        media({ pk: '1-a', original_width: 1440, original_height: 1654 }),
      ],
    })
    expect(needsUpgrade(carousel)).toBe(true)
  })
})

describe('upgradeMedia', () => {
  const page = post({
    original_width: 1440,
    original_height: 944,
    image_versions2: {
      candidates: [
        { url: 'https://cdn/1440.jpg', width: 1440, height: 944 },
        { url: 'https://cdn/1080.jpg', width: 1080, height: 708 },
      ],
    },
  })

  it('replaces the candidate ladder with the larger page version', () => {
    const target = post({ original_width: 1440, original_height: 944 })
    expect(upgradeMedia(target, page)).toBe(true)
    expect(target.image_versions2.candidates[0]?.url).toBe('https://cdn/1440.jpg')
  })

  it('leaves the target untouched when the page is not larger', () => {
    const target = post({
      original_width: 1440,
      original_height: 944,
      image_versions2: {
        candidates: [
          { url: 'https://cdn/keep.jpg', width: 1440, height: 944 },
        ],
      },
    })
    expect(upgradeMedia(target, page)).toBe(false)
    expect(target.image_versions2.candidates[0]?.url).toBe('https://cdn/keep.jpg')
  })

  it('returns false when the page payload is missing', () => {
    expect(upgradeMedia(post(), null)).toBe(false)
  })

  it('aligns carousel children by pk before falling back to index', () => {
    const target = post({
      media_type: 8,
      original_width: 1440,
      original_height: 1654,
      carousel_media: [
        media({ pk: 'child-a', original_width: 1440, original_height: 1654 }),
        media({ pk: 'child-b', original_width: 1440, original_height: 1654 }),
      ],
    })
    const source = post({
      media_type: 8,
      carousel_media: [
        media({
          pk: 'child-b',
          image_versions2: {
            candidates: [
              { url: 'https://cdn/b.jpg', width: 1440, height: 1654 },
            ],
          },
        }),
        media({
          pk: 'child-a',
          image_versions2: {
            candidates: [
              { url: 'https://cdn/a.jpg', width: 1440, height: 1654 },
            ],
          },
        }),
      ],
    })

    expect(upgradeMedia(target, source)).toBe(true)
    expect(target.carousel_media?.[1]?.image_versions2.candidates[0]?.url).toBe('https://cdn/b.jpg')
    expect(target.carousel_media?.[0]?.image_versions2.candidates[0]?.url).toBe('https://cdn/a.jpg')
  })

  it('does not overwrite video renditions', () => {
    const target = post({
      media_type: 2,
      original_width: 1080,
      original_height: 1920,
      video_versions: [
        {
          url: 'https://cdn/keep.mp4',
          width: 1080,
          height: 1920,
          type: 101,
        },
      ],
    })
    const source = post({
      media_type: 2,
      video_versions: [
        {
          url: 'https://cdn/other.mp4',
          width: 720,
          height: 1280,
          type: 101,
        },
      ],
    })

    upgradeMedia(target, source)
    expect(target.video_versions?.[0]?.url).toBe('https://cdn/keep.mp4')
  })
})
