/** Public links for the two versions of the one site. The host comes from PUBLIC_BASE_URL. */

export function versionPath(mode) {
  return mode === 'after_event' ? '/virtual' : mode === 'event_day' ? '/events' : ''
}

export function versionRoots(publicBase) {
  const root = String(publicBase || '').replace(/\/$/, '')
  return {
    event_day: `${root}/events`,
    after_event: `${root}/virtual`
  }
}

export function versionLabel(mode, publicBase) {
  const path = versionPath(mode)
  if (!path) return ''
  const base = String(publicBase || '').replace(/\/$/, '')
  if (!base) return path
  try {
    return new URL(base).host + path
  } catch {
    return path
  }
}
