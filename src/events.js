import { HttpError } from './http.js'

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

export function assertEventDate(value) {
  const date = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Choose the event date.')
  const [year, month, day] = date.split('-').map(Number)
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    throw new HttpError(400, 'Choose a real event date.')
  }
  return date
}

export function mergeEvents(configEvents, sheetEvents, liveSlug) {
  const events = (configEvents || []).map((event) => ({ ...event }))
  const taken = new Set(events.map((event) => event.slug))
  for (const event of sheetEvents || []) {
    if (!event?.slug || taken.has(event.slug)) continue
    events.push(event)
    taken.add(event.slug)
  }
  const live = events.find((event) => event.slug === liveSlug && event.active !== false)
  return { events, liveSlug: live ? live.slug : '' }
}
