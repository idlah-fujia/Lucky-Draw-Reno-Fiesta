export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function cookies(c) {
  const header = c.req.header('cookie') || ''
  const out = {}
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index > 0) {
      out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim())
    }
  }
  return out
}

export function clientIp(c) {
  if (process.env.TRUST_PROXY === '1') {
    const forwarded = c.req.header('x-forwarded-for')
    if (forwarded) return forwarded.split(',')[0].trim()
  }
  return c.req.header('x-real-ip') || 'local'
}

export function requestBaseUrl(c) {
  const configured = (process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '')
  if (configured) return configured
  const proto = c.req.header('x-forwarded-proto') || 'http'
  const host = c.req.header('x-forwarded-host') || c.req.header('host')
  if (host && host !== 'undefined') return `${proto}://${host}`
  return `http://127.0.0.1:${process.env.PORT || 47231}`
}

const buckets = new Map()

export function rateLimit(key, limit, windowMs) {
  const now = Date.now()
  let bucket = buckets.get(key)
  if (!bucket || now - bucket.start > windowMs) {
    bucket = { start: now, n: 0 }
    buckets.set(key, bucket)
  }
  bucket.n += 1
  if (buckets.size > 5000) {
    for (const [name, value] of buckets) {
      if (now - value.start > windowMs) buckets.delete(name)
    }
  }
  return bucket.n <= limit
}

export function todaySGT(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now)
}

export function formatWhen(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date)
}
