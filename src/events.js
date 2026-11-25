import { HttpError } from './http.js'
import { normalizeHeader } from './sheetHeader.js'

export const EVENT_COLUMNS = ['slug', 'name', 'starts', 'ends', 'edition', 'active', 'created_at', 'created_by']

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function slugifyEventName(name) {
  const slug = String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '')
  if (!/^[a-z0-9-]{2,60}$/.test(slug)) {
    throw new HttpError(400, 'Use an event name with at least two letters or numbers.')
  }
  return slug
}

export function uniqueSlug(base, taken) {
  if (!taken.has(base)) return base
  for (let n = 2; n < 100; n += 1) {
    const next = `${base}-${n}`.slice(0, 60)
    if (!taken.has(next)) return next
  }
  throw new HttpError(409, 'That event name is already in use.')
}

export function assertEventDate(value, label = 'the event date') {
  const date = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, `Choose ${label}.`)
  const [year, month, day] = date.split('-').map(Number)
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    throw new HttpError(400, `Choose a real ${label}.`)
  }
  return date
}

/** A new event may be one day (start = end) or several days. `date` is the old single-day field. */
export function eventRange(body = {}) {
  const startRaw = body.starts || body.start || body.date
  const endRaw = body.ends || body.end || startRaw
  const starts = assertEventDate(startRaw, 'the start date')
  const ends = assertEventDate(endRaw, 'the end date')
  if (ends < starts) throw new HttpError(400, 'The end date can’t be before the start date.')
  return { starts, ends, date: String(body.date || starts) }
}

export function normalizeStoredEvent(event = {}) {
  const legacy = String(event.date || '').trim()
  const starts = String(event.starts || legacy || '').trim()
  const ends = String(event.ends || starts || '').trim()
  return { ...event, date: legacy || starts, starts, ends }
}

/**
 * Keep an older Events header, including a single `date` column, and append
 * `starts` and `ends` when they are missing so ensureColumns can extend it.
 */
export function eventSheetColumns(header) {
  const names = normalizeHeader(header)
  if (!names.length) return EVENT_COLUMNS.slice()
  if (names.includes('starts') && names.includes('ends')) return names
  const next = names.slice()
  if (!next.includes('starts')) next.push('starts')
  if (!next.includes('ends')) next.push('ends')
  return next
}

export function eventFromCells(header, row) {
  const names = normalizeHeader(header)
  const cell = {}
  names.forEach((name, index) => {
    cell[name] = row?.[index] == null ? '' : String(row[index])
  })
  return normalizeStoredEvent({
    slug: cell.slug || '',
    name: cell.name || cell.slug || '',
    date: cell.date || '',
    starts: cell.starts || '',
    ends: cell.ends || '',
    edition: cell.edition || '',
    active: cell.active !== 'no',
    created_at: cell.created_at || '',
    created_by: cell.created_by || '',
    mode: cell.mode || ''
  })
}

export function eventNeedsDateBackfill(header, row) {
  const names = normalizeHeader(header)
  const cell = {}
  names.forEach((name, index) => {
    cell[name] = String(row?.[index] ?? '').trim()
  })
  const legacy = cell.date || cell.starts || ''
  if (!legacy) return false
  return !cell.starts || !cell.ends
}

function dateParts(iso) {
  const [year, month, day] = String(iso || '').split('-').map(Number)
  if (!year || !month || !day) return null
  return { year, month, day }
}

/** '27 Nov 2026', or '27-28 Nov 2026' when the month is the same. */
export function formatEventRange(starts, ends) {
  const from = dateParts(starts)
  if (!from) return ''
  const to = dateParts(ends || starts) || from
  const month = MONTHS[from.month - 1] || ''
  const endMonth = MONTHS[to.month - 1] || ''
  if (from.year === to.year && from.month === to.month && from.day === to.day) {
    return `${from.day} ${month} ${from.year}`
  }
  if (from.year === to.year && from.month === to.month) {
    return `${from.day}-${to.day} ${month} ${from.year}`
  }
  if (from.year === to.year) return `${from.day} ${month}–${to.day} ${endMonth} ${from.year}`
  return `${from.day} ${month} ${from.year}–${to.day} ${endMonth} ${to.year}`
}

export function mergeEvents(configEvents, sheetEvents, liveSlug) {
  const events = (configEvents || []).map((event) => normalizeStoredEvent({ ...event }))
  const taken = new Set(events.map((event) => event.slug))
  for (const event of sheetEvents || []) {
    const normalized = normalizeStoredEvent(event)
    if (!normalized?.slug || taken.has(normalized.slug)) continue
    events.push(normalized)
    taken.add(normalized.slug)
  }
  const live = events.find((event) => event.slug === liveSlug && event.active !== false)
  return { events, liveSlug: live ? live.slug : '' }
}
