import { HttpError, todaySGT } from './http.js'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value) {
  return UUID.test(String(value || ''))
}

export function cleanText(value, { min, max, label }) {
  const text = String(value || '').replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim()
  if (text.length < min) throw new HttpError(400, `Enter ${label}.`)
  if (text.length > max) throw new HttpError(400, `${label} is too long.`)
  return text
}

export function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '')
  if (digits.startsWith('65') && digits.length === 10) digits = digits.slice(2)
  return digits
}

export function homeownerPhone(value) {
  const phone = normalizePhone(value)
  if (!/^[89]\d{7}$/.test(phone)) {
    throw new HttpError(400, 'Enter a valid homeowner mobile (8 digits, starting with 8 or 9).')
  }
  return phone
}

export function designerPhone(value) {
  const phone = normalizePhone(value)
  if (!/^[3689]\d{7}$/.test(phone)) {
    throw new HttpError(400, 'Enter a valid designer number (8 digits).')
  }
  return phone
}

export function emailAddress(value, label) {
  const email = String(value || '').trim().toLowerCase()
  if (!EMAIL.test(email) || email.length > 120) throw new HttpError(400, `Enter ${label}.`)
  return email
}

export function eventDate(value, event, now = new Date()) {
  const date = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !realCalendarDay(date)) {
    throw new HttpError(400, 'Choose a date from that event.')
  }
  const today = todaySGT(now)
  if (date > today) throw new HttpError(400, 'The date you attended can’t be in the future.')
  if (event.starts && date < event.starts) {
    throw new HttpError(400, `${event.name} runs from ${event.starts}. That date is before the event.`)
  }
  if (event.ends && date > event.ends) {
    throw new HttpError(400, `${event.name} runs until ${event.ends}. That date is after the event.`)
  }
  return date
}

function realCalendarDay(iso) {
  const [year, month, day] = iso.split('-').map(Number)
  const utc = new Date(Date.UTC(year, month - 1, day))
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day
}

export function requireYes(value, message) {
  if (String(value || '') !== 'yes') throw new HttpError(400, message)
}

export function sniffProof(buffer, filename) {
  const name = String(filename || '').toLowerCase()
  if (buffer.length < 32) return null
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf'
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png'
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp'
  }
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('latin1')
    if (/heic|heix|heif|mif1|msf1|hevc|hevx/i.test(brand) || name.endsWith('.heic') || name.endsWith('.heif')) {
      return name.endsWith('.heif') ? 'image/heif' : 'image/heic'
    }
  }
  return null
}

export function safeFilename(name) {
  const base = String(name || 'proof').split(/[/\\]/).pop().replace(/[^\w.\- ()]/g, '')
  return base.slice(0, 120) || 'proof'
}

export const MAX_PROOF_BYTES = 10 * 1024 * 1024
