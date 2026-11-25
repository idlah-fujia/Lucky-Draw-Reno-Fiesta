/** LED-screen registration QR. Size is either a percent of the viewport width or pixels. */

export const POSITIONS = [
  'top-center',
  'top-left',
  'top-right',
  'bottom-center',
  'bottom-left',
  'bottom-right'
]

export const PERCENT_MIN = 16
export const PERCENT_MAX = 70
export const PX_MIN = 160
export const PX_MAX = 900
export const GLOBAL_EVENT = '*'

export const DEFAULT_QR = { size: 16, unit: 'percent', position: 'top-center' }

export const QR_LIMITS = {
  percent: [PERCENT_MIN, PERCENT_MAX],
  px: [PX_MIN, PX_MAX],
  positions: POSITIONS
}

export function clampSize(size, unit) {
  const kind = unit === 'px' ? 'px' : unit === 'percent' ? 'percent' : null
  const n = Number(size)
  if (!kind || !Number.isFinite(n)) return null
  const rounded = Math.round(n)
  if (kind === 'px' && (rounded < PX_MIN || rounded > PX_MAX)) return null
  if (kind === 'percent' && (rounded < PERCENT_MIN || rounded > PERCENT_MAX)) return null
  return { size: rounded, unit: kind }
}

/** Accepts 34, 34%, or 480px. Empty means unset. */
export function parseSizeToken(raw) {
  const text = String(raw ?? '').trim().toLowerCase()
  if (!text) return null
  const px = text.match(/^(\d+(?:\.\d+)?)\s*px$/)
  if (px) return clampSize(px[1], 'px')
  const percent = text.match(/^(\d+(?:\.\d+)?)\s*%$/)
  if (percent) return clampSize(percent[1], 'percent')
  if (/^\d+(?:\.\d+)?$/.test(text)) return clampSize(text, 'percent')
  return null
}

export function parsePosition(raw) {
  const text = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/centre/g, 'center')
    .replace(/[\s_]+/g, '-')
  return POSITIONS.includes(text) ? text : null
}

export function envKioskQr(env = process.env) {
  const sized = parseSizeToken(env.KIOSK_QR_SIZE || '')
  const position = parsePosition(env.KIOSK_QR_POSITION || '')
  return {
    size: sized?.size ?? DEFAULT_QR.size,
    unit: sized?.unit ?? DEFAULT_QR.unit,
    position: position || DEFAULT_QR.position
  }
}

export function normalizeSaved(input) {
  if (!input || typeof input !== 'object') return null
  const sized = clampSize(input.size, input.unit === 'px' ? 'px' : input.unit === 'percent' ? 'percent' : null)
  const position = parsePosition(input.position)
  if (!sized || !position) return null
  return {
    size: sized.size,
    unit: sized.unit,
    position,
    updatedAt: input.updatedAt ? String(input.updatedAt) : ''
  }
}

/** Event row wins, then the saved default, then KIOSK_QR_* / built-in defaults. */
export function resolveKioskQr(map, eventSlug, env = process.env) {
  const saved = map && typeof map === 'object' ? map : {}
  const event = eventSlug ? normalizeSaved(saved[eventSlug]) : null
  const global = normalizeSaved(saved[GLOBAL_EVENT])
  if (event) return { ...event, source: 'event' }
  if (global) return { ...global, source: 'global' }
  const fallback = envKioskQr(env)
  const fromEnv = String(env.KIOSK_QR_SIZE || '').trim() || String(env.KIOSK_QR_POSITION || '').trim()
  return { ...fallback, updatedAt: '', source: fromEnv ? 'env' : 'default' }
}
