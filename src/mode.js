/** event_day is the LED at the venue. after_event is the phone link sent afterwards. */

export function siteMode(env = process.env) {
  const value = String(env.SITE_MODE || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  return value === 'event_day' ? 'event_day' : 'after_event'
}

/** An event's own mode wins. Otherwise the service's SITE_MODE is used. */
export function eventMode(event, fallback = siteMode()) {
  const value = String(event?.mode || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (value === 'event_day' || value === 'after_event') return value
  return fallback === 'event_day' ? 'event_day' : 'after_event'
}

export function prefixFor(mode) {
  return mode === 'after_event' ? '/virtual' : '/events'
}

export function modeFromPath(path = '') {
  const value = String(path)
  if (value === '/virtual' || value.startsWith('/virtual/')) return 'after_event'
  if (value === '/events' || value.startsWith('/events/')) return 'event_day'
  return ''
}

export function modeFromMount(value) {
  const text = String(value || '').trim().toLowerCase()
  if (text === 'virtual' || text === 'after_event') return 'after_event'
  if (text === 'events' || text === 'event_day') return 'event_day'
  return ''
}

export function defaultEvent(config) {
  if (!config?.events?.length) return null
  return config.events.find((event) => event.active) || config.events[0]
}
