import { randomInt } from 'node:crypto'

/** Unambiguous: no O/0, I/1/L. 31 symbols, 8 chars. */
export const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function generateCode() {
  let code = ''
  for (let i = 0; i < 8; i += 1) code += ALPHABET[randomInt(ALPHABET.length)]
  return code
}

export function formatCode(code) {
  const clean = String(code || '')
  if (clean.length !== 8) return clean
  return `${clean.slice(0, 4)} ${clean.slice(4)}`
}

export function parseCode(input) {
  const compact = String(input || '').toUpperCase().replace(/[\s-]/g, '')
  if (!compact) return { error: 'Enter the 8-character spin code.' }
  if (compact.length !== 8) return { error: 'Enter all 8 characters.' }
  const bad = [...compact].filter((ch) => !ALPHABET.includes(ch))
  if (bad.length) {
    const shown = [...new Set(bad)].join(' ')
    return {
      error: `“${shown}” isn’t used on these codes. Spin codes skip the lookalike characters O, 0, I, 1 and L.`
    }
  }
  return { code: compact }
}
