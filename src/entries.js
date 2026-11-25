import { HttpError } from './http.js'
import { soldOutIds } from './prizes.js'
import { normalizePhone } from './validate.js'

export const DUPLICATE_PAIR_MESSAGE = 'This homeowner has already spun with this designer.'

export function firstName(fullName) {
  const part = String(fullName || '').trim().split(/\s+/)[0]
  return part || 'there'
}

function findCode(list, code) {
  return list.find((entry) => entry.code === code) || null
}

export function pairPhones(entry) {
  return {
    homeowner: normalizePhone(entry?.homeowner_phone),
    designer: normalizePhone(entry?.designer_phone)
  }
}

/** Voided, spam, and logged duplicate attempts do not hold the pair. */
export function countsAsPair(row) {
  if (!row) return false
  if (row.status === 'voided' || row.status === 'spam' || row.status === 'duplicate') return false
  if (row.voided_at || row.spam_at) return false
  return true
}

export function findDuplicatePair(list, entry) {
  const next = pairPhones(entry)
  if (!next.homeowner || !next.designer) return null
  return (list || []).find((row) => {
    if (!countsAsPair(row)) return false
    const prev = pairPhones(row)
    return prev.homeowner === next.homeowner && prev.designer === next.designer
  }) || null
}

export function createEntry(list, entry) {
  if (findDuplicatePair(list, entry)) {
    const error = new HttpError(409, DUPLICATE_PAIR_MESSAGE)
    error.code = 'duplicate_pair'
    throw error
  }
  if (entry.code && list.some((row) => row.code && row.code === entry.code)) {
    throw new HttpError(409, 'Please submit the form once more.')
  }
  list.push(entry)
  return entry
}

export function saveDesigner(list, code, fields, nowIso, eventSlug, options) {
  const entry = requireEventCode(list, code, eventSlug, options)
  if (entry.status === 'voided') {
    throw new HttpError(409, 'This code has been voided. Please see the IDLah booth.')
  }
  if (entry.status === 'spam') {
    throw new HttpError(409, 'This code can’t be used. Please see the IDLah booth.')
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

export function spinEntry(list, code, prize, nowIso, config, eventSlug, options) {
  const entry = requireEventCode(list, code, eventSlug, options)
  if (entry.status === 'voided') {
    throw new HttpError(409, 'This code has been voided. Please see the IDLah booth.')
  }
  if (entry.status === 'spam') {
    throw new HttpError(409, 'This code can’t be used. Please see the IDLah booth.')
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

export function reviewEntry(list, id, action, nowIso, actor = '') {
  const entry = list.find((row) => row.id === id)
  if (!entry) throw new HttpError(404, 'Entry not found.')
  if (action === 'verify') {
    if (entry.status === 'voided') throw new HttpError(409, 'Undo the void before verifying.')
    if (entry.status === 'spam') throw new HttpError(409, 'Undo spam before verifying.')
    entry.status = 'verified'
    entry.verified_at = entry.verified_at || nowIso
    entry.verified_by = actor
  } else if (action === 'spam') {
    if (entry.status === 'voided') throw new HttpError(409, 'Undo the void before marking spam.')
    entry.status = 'spam'
    entry.spam_at = entry.spam_at || nowIso
    entry.spam_by = actor
  } else if (action === 'undo-spam') {
    if (entry.status !== 'spam') throw new HttpError(409, 'This entry is not spam.')
    entry.spam_at = ''
    entry.spam_by = ''
    restoreStatus(entry)
  } else if (action === 'void') {
    entry.status = 'voided'
    entry.voided_at = nowIso
    entry.voided_by = actor
  } else if (action === 'undo-void') {
    if (entry.status !== 'voided') throw new HttpError(409, 'This entry is not voided.')
    entry.voided_at = ''
    restoreStatus(entry)
  } else {
    throw new HttpError(400, 'Unknown action.')
  }
  entry.updated_at = nowIso
  return entry
}

/** Server-side gate for the kiosk. The browser must not advance without this. */
export function verifySpinCode(list, code, eventSlug, config, options) {
  const entry = requireEventCode(list, code, eventSlug, options)
  return attachSoldOut(kioskView(entry, config), list, config)
}

function requireEventCode(list, code, eventSlug, { allowAnyEvent = false, afterEvent = false } = {}) {
  const event = String(eventSlug || '').trim()
  if (!event && !allowAnyEvent) {
    throw new HttpError(400, 'This screen is not tied to an event. Open the spin page with the event link.')
  }
  const entry = findCode(list, code)
  if (!entry) {
    throw new HttpError(404, afterEvent
      ? 'Code not recognised. Check the code from your spin link: 8 characters, no O, 0, I, 1 or L.'
      : 'Code not recognised. Check the code on the homeowner’s phone.')
  }
  if (event && entry.event_slug !== event) {
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
  if (entry.status === 'spam') return { ...base, state: 'spam', soldOut }
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

function restoreStatus(entry) {
  if (entry.prize_id && entry.verified_at) entry.status = 'verified'
  else if (entry.prize_id) entry.status = 'spun'
  else if (entry.verified_at) entry.status = 'verified'
  else entry.status = 'submitted'
}

export function dashboardCounts(entries) {
  const rows = entries || []
  let submitted = 0
  let spam = 0
  let verified = 0
  let voided = 0
  let iphone = 0
  for (const row of rows) {
    const isSpam = row.status === 'spam' || !!row.spam_at
    const isVoid = row.status === 'voided' || !!row.voided_at
    if (row.code && !isSpam && !isVoid) submitted += 1
    if (isSpam) spam += 1
    if (row.verified_at) verified += 1
    if (isVoid) voided += 1
    if (row.prize_id === 'IPHONE' && !isVoid) iphone += 1
  }
  return { total: rows.length, submitted, spam, verified, voided, iphone }
}
