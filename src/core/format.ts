/** Shared ANSI formatting and display utilities. */

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const val = bytes / 1024 ** i
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

const BOLD = '\x1B[1m'
const DIM = '\x1B[2m'
const CYAN = '\x1B[36m'
const GREEN = '\x1B[32m'
const YELLOW = '\x1B[33m'
const RESET = '\x1B[0m'

export function b(s: string): string { return `${BOLD}${s}${RESET}` }
export function dim(s: string): string { return `${DIM}${s}${RESET}` }
export function c(s: string): string { return `${CYAN}${s}${RESET}` }
export function g(s: string): string { return `${GREEN}${s}${RESET}` }
export const _YELLOW = YELLOW
export const _RESET = RESET

export function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length)
}
