export const NOT_ATTENDED_MESSAGE = 'We couldn\'t find this homeowner\'s attendance at this event. Please check the phone number and event, or contact the IDLah team.'
export const NO_CHECKIN_MESSAGE = 'This event has no check-in records, so the after-event spin isn’t open. Please contact the IDLah team.'
export const UNAVAILABLE_MESSAGE = 'We can\'t verify attendance right now, please try again later.'

const CACHE_MS = 60_000
const cache = new Map()

export function renocodeConfigured(env = process.env) {
  return !!(String(env.RENOCODE_SUPABASE_URL || '').trim() && String(env.RENOCODE_SUPABASE_KEY || '').trim())
}

export function renocodeStatus(env = process.env) {
  return renocodeConfigured(env) ? 'configured' : 'missing'
}

export function clearRenocodeCache() {
  cache.clear()
}

/** Last 8 digits, after every non-digit is removed. Shorter values do not match. */
export function phoneKey(value) {
  const digits = String(value || '').replace(/\D/g, '')
  if (digits.length < 8) return ''
  return digits.slice(-8)
}

export function flagTrue(value) {
  if (value === true || value === 1) return true
  const text = String(value == null ? '' : value).trim().toLowerCase()
  return text === 'true' || text === 't' || text === 'yes' || text === '1'
}

/**
 * arrived=true on at least one row for this phone, and no matching row flagged
 * scammer or pre_scammer. Zero arrived rows for the whole event means no check-in.
 */
export function attendanceDecision(attendees, phone) {
  const rows = Array.isArray(attendees) ? attendees : []
  const anyArrived = rows.some((row) => flagTrue(row?.arrived))
  if (!anyArrived) return { ok: false, reason: 'no_checkin' }
  const key = phoneKey(phone)
  const mine = key ? rows.filter((row) => phoneKey(row?.phone) === key) : []
  if (!mine.length || !mine.some((row) => flagTrue(row.arrived))) return { ok: false, reason: 'not_attended' }
  if (mine.some((row) => flagTrue(row.scammer) || flagTrue(row.pre_scammer))) return { ok: false, reason: 'not_attended' }
  return { ok: true }
}

export function messageForReason(reason) {
  if (reason === 'no_checkin') return NO_CHECKIN_MESSAGE
  return NOT_ATTENDED_MESSAGE
}

function restBase(url) {
  const trimmed = String(url || '').trim().replace(/\/$/, '')
  if (/\/rest\/v1$/i.test(trimmed)) return trimmed
  return `${trimmed}/rest/v1`
}

function timeoutSignal(ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    try { controller.abort() } catch { /* already aborted */ }
  }, ms)
  return { signal: controller.signal, done() { clearTimeout(timer) } }
}

function withoutKey(message, key) {
  const text = String(message || 'Renocode request failed')
  if (!key) return text.slice(0, 180)
  return text.split(key).join('[redacted]').slice(0, 180)
}

async function renocodeGet(fetchImpl, url, key, signal, headers) {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      accept: 'application/json',
      ...headers
    },
    signal
  })
  if (response.status === 416) return { rows: [], response }
  if (!response.ok) {
    throw Object.assign(new Error(`Renocode HTTP ${response.status}`), { code: 'renocode_http' })
  }
  const rows = await response.json()
  if (!Array.isArray(rows)) {
    throw Object.assign(new Error('Renocode returned an unexpected list'), { code: 'renocode_http' })
  }
  return { rows, response }
}

export async function loadAttendees(code, env = process.env, options = {}) {
  const eventCode = String(code || '').trim().toUpperCase()
  const now = options.now ? options.now() : Date.now()
  const hit = cache.get(eventCode)
  if (hit && now - hit.at < CACHE_MS) return hit.attendees
  const base = String(env.RENOCODE_SUPABASE_URL || '').trim()
  const key = String(env.RENOCODE_SUPABASE_KEY || '').trim()
  if (!base || !key) {
    throw Object.assign(new Error('Renocode is not configured'), { code: 'renocode_unconfigured' })
  }
  const fetchImpl = options.fetchImpl || fetch
  const timer = timeoutSignal(options.timeoutMs || 8000)
  try {
    const eventsUrl = `${restBase(base)}/events?code=eq.${encodeURIComponent(eventCode)}&select=id,code`
    const found = await renocodeGet(fetchImpl, eventsUrl, key, timer.signal)
    const eventId = found.rows[0] && found.rows[0].id
    if (!eventId) {
      throw Object.assign(new Error('Renocode event was not found'), { code: 'renocode_event_missing' })
    }
    const attendees = []
    const pageSize = 1000
    for (let start = 0; start < 20_000; start += pageSize) {
      const url = `${restBase(base)}/attendees?event_id=eq.${encodeURIComponent(eventId)}&select=phone,arrived,scammer,pre_scammer`
      const page = await renocodeGet(fetchImpl, url, key, timer.signal, { range: `${start}-${start + pageSize - 1}`, prefer: 'count=exact' })
      const previous = start > 0 ? attendees[start - pageSize] : null
      if (previous && page.rows[0] && page.rows[0].phone === previous.phone) break
      attendees.push(...page.rows)
      const total = Number(String(page.response.headers.get('content-range') || '').split('/')[1])
      if (page.rows.length < pageSize) break
      if (Number.isFinite(total) && attendees.length >= total) break
    }
    cache.set(eventCode, { at: now, attendees })
    return attendees
  } catch (error) {
    if (error?.name === 'AbortError' || error?.code === 'renocode_timeout') {
      throw Object.assign(new Error('Renocode timed out'), { code: 'renocode_timeout' })
    }
    if (error?.code) throw error
    throw Object.assign(new Error(withoutKey(error?.message, key)), { code: 'renocode_http' })
  } finally {
    timer.done()
  }
}

export async function checkAfterEventAttendance(event, phone, afterEvent, env = process.env, options = {}) {
  if (!afterEvent) return { action: 'allow' }
  const code = String(event?.renocode_code || '').trim()
  if (!code) return { action: 'allow' }
  if (!renocodeConfigured(env)) return { action: 'unavailable' }
  try {
    const attendees = await loadAttendees(code, env, options)
    const decision = attendanceDecision(attendees, phone)
    if (decision.ok) return { action: 'allow' }
    return { action: 'block', reason: decision.reason }
  } catch (error) {
    console.error('Renocode attendance check failed', error?.code || 'error')
    return { action: 'unavailable' }
  }
}
