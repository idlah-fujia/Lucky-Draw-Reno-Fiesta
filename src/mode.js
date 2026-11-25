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

export function defaultEvent(config) {
  if (!config?.events?.length) return null
  return config.events.find((event) => event.active) || config.events[0]
}
