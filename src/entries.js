import { HttpError } from './http.js'
import { soldOutIds } from './prizes.js'

export function firstName(fullName) {
  const part = String(fullName || '').trim().split(/\s+/)[0]
  return part || 'there'
}

function findCode(list, code) {
  return list.find((entry) => entry.code === code) || null
}

export function createEntry(list, entry) {
  const duplicate = list.find((row) =>
    row.event_slug === entry.event_slug &&
    row.homeowner_phone === entry.homeowner_phone &&
    row.status !== 'voided'
  )
  if (duplicate) {
    throw new HttpError(
      409,
      'This mobile number is already registered for this event. Check your email for the spin code, or ask the IDLah booth. Each homeowner gets one spin.'
    )
  }
  if (list.some((row) => row.code === entry.code)) {
    throw new HttpError(409, 'Please submit the form once more.')
  }
  list.push(entry)
  return entry
}

export function saveDesigner(list, code, fields, nowIso, eventSlug) {
  const entry = requireEventCode(list, code, eventSlug)
  if (entry.status === 'voided') {
    throw new HttpError(409, 'This code has been voided. Please see the IDLah booth.')
  }
  if (entry.prize_id) {
    throw new HttpError(409, 'This code has already been used.')
  }
  if (entry.status !== 'submitted' && entry.status !== 'verified') {
    throw new HttpError(409, 'This code can’t be used.')
  }
  if (fields.designer_phone === entry.homeowner_phone) {
    throw new HttpError(400, 'The designer’s number must be different from the homeowner’s number.')
  }
  entry.designer_name = fields.designer_name
  entry.designer_phone = fields.designer_phone
  entry.designer_email = fields.designer_email
  entry.id_company = fields.id_company
  entry.designer_saved_at = nowIso
  entry.updated_at = nowIso
  return entry
}

export function spinEntry(list, code, prize, nowIso, config, eventSlug) {
  const entry = requireEventCode(list, code, eventSlug)
  if (entry.status === 'voided') {
    throw new HttpError(409, 'This code has been voided. Please see the IDLah booth.')
  }
  if (entry.prize_id) return { entry, already: true }
  if (!entry.designer_name || !entry.designer_phone || !entry.designer_email || !entry.id_company) {
    throw new HttpError(400, 'This code has no interior designer on it, so it can’t spin. Please see the IDLah booth.')
  }
  const sold = soldOutIds(list, entry.event_slug, config)
  if (prize.oncePerEvent && sold.includes(prize.id)) {
    const error = new HttpError(409, 'That top prize has already been won for this event.')
    error.code = 'prize_taken'
    throw error
  }
  entry.prize_id = prize.id
  entry.prize_label = prize.label
  entry.prize_brand = prize.brand
  entry.prize_slot = String(prize.slot)
  entry.spun_at = nowIso
  entry.updated_at = nowIso
  if (entry.status !== 'verified') entry.status = 'spun'
  return { entry, already: false }
}

export function reviewEntry(list, id, action, nowIso) {
  const entry = list.find((row) => row.id === id)
  if (!entry) throw new HttpError(404, 'Entry not found.')
  if (action === 'verify') {
    if (entry.status === 'voided') throw new HttpError(409, 'Undo the void before verifying.')
    entry.status = 'verified'
    entry.verified_at = entry.verified_at || nowIso
  } else if (action === 'void') {
    entry.status = 'voided'
    entry.voided_at = nowIso
  } else if (action === 'undo-void') {
    if (entry.status !== 'voided') throw new HttpError(409, 'This entry is not voided.')
    entry.voided_at = ''
    if (entry.prize_id && entry.verified_at) entry.status = 'verified'
    else if (entry.prize_id) entry.status = 'spun'
    else if (entry.verified_at) entry.status = 'verified'
    else entry.status = 'submitted'
  } else {
    throw new HttpError(400, 'Unknown action.')
  }
  entry.updated_at = nowIso
  return entry
}

/** Server-side gate for the kiosk. The browser must not advance without this. */
export function verifySpinCode(list, code, eventSlug, config) {
  const entry = requireEventCode(list, code, eventSlug)
  return attachSoldOut(kioskView(entry, config), list, config)
}

function requireEventCode(list, code, eventSlug) {
  const event = String(eventSlug || '').trim()
  if (!event) {
    throw new HttpError(400, 'This screen is not tied to an event. Open the spin page with the event link.')
  }
  const entry = findCode(list, code)
  if (!entry) throw new HttpError(404, 'Code not recognised. Check the code on the homeowner’s phone.')
  if (entry.event_slug !== event) {
    throw new HttpError(409, `This code is for ${entry.event_name}, not this screen.`)
  }
  return entry
}

export function kioskView(entry, config) {
  if (!entry) return { state: 'invalid' }
  const soldOut = []
  const base = {
    code: entry.code,
    firstName: firstName(entry.homeowner_name),
    eventName: entry.event_name,
    eventSlug: entry.event_slug,
    eventEdition: entry.event_edition || ''
  }
  if (entry.status === 'voided') return { ...base, state: 'voided', soldOut }
  if (entry.prize_id) {
    return {
      ...base,
      state: 'spun',
      soldOut,
      result: {
        slot: Number(entry.prize_slot),
        prizeId: entry.prize_id,
        label: entry.prize_label,
        brand: entry.prize_brand
      }
    }
  }
  const designerReady = !!(entry.designer_name && entry.designer_phone && entry.designer_email && entry.id_company)
  return {
    ...base,
    state: designerReady ? 'ready' : 'needs_designer',
    soldOut,
    designer: designerReady ? { name: entry.designer_name, company: entry.id_company } : null
  }
}

export function attachSoldOut(view, list, config) {
  if (!view || !view.eventSlug) return view
  const soldOut = soldOutIds(list, view.eventSlug, config)
  return {
    ...view,
    soldOut,
    iphoneRedeemed: soldOut.includes('IPHONE'),
    canContinue: view.state === 'ready'
  }
}
