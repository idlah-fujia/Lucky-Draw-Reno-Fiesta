export function prizeMap(config) {
  return new Map(config.prizes.map((prize) => [prize.id, prize]))
}

export function soldOutIds(list, eventSlug, config) {
  const once = new Set(config.prizes.filter((prize) => prize.oncePerEvent).map((prize) => prize.id))
  const won = new Set()
  for (const entry of list) {
    if (entry.event_slug !== eventSlug) continue
    if (entry.status === 'voided') continue
    if (entry.prize_id && once.has(entry.prize_id)) won.add(entry.prize_id)
  }
  return [...won]
}

/**
 * Pick a slice. Each slice contributes its prize's weight, so a prize printed
 * on more slices is more likely. Sold-out prizes (weight 0 or once-per-event
 * already won) are left off.
 */
function isGrab(id) {
  return String(id || '').startsWith('GRAB')
}

/** Live slices. A sold-out iPhone's tickets are added to the Grab slices. */
export function wheelTickets(config, soldOut = []) {
  const sold = new Set(soldOut || [])
  const prizes = prizeMap(config)
  const rows = []
  config.slots.forEach((id, slot) => {
    const prize = prizes.get(id)
    if (!prize) return
    const weight = Number(prize.weight) || 0
    if (weight <= 0) return
    rows.push({ slot, id, prize, weight })
  })
  const iphoneTickets = rows.filter((row) => row.id === 'IPHONE').reduce((sum, row) => sum + row.weight, 0)
  const available = rows.filter((row) => !sold.has(row.id)).map((row) => ({ ...row }))
  if (sold.has('IPHONE') && iphoneTickets > 0) {
    const grabs = available.filter((row) => isGrab(row.id))
    const grabSum = grabs.reduce((sum, row) => sum + row.weight, 0)
    if (grabSum > 0) {
      for (const row of grabs) row.weight += iphoneTickets * (row.weight / grabSum)
    }
  }
  return available
}

export function pickPrize(config, soldOut, rng = Math.random) {
  const available = wheelTickets(config, soldOut)
  if (!available.length) {
    const error = new Error('No prizes are left on the wheel.')
    error.status = 409
    throw error
  }
  const total = available.reduce((sum, item) => sum + item.weight, 0)
  let cursor = rng() * total
  for (const item of available) {
    cursor -= item.weight
    if (cursor < 0) return describe(item)
  }
  return describe(available[available.length - 1])
}

function describe(item) {
  return {
    slot: item.slot,
    id: item.prize.id,
    label: item.prize.label,
    brand: item.prize.brand,
    oncePerEvent: !!item.prize.oncePerEvent
  }
}

export function oddsTable(config, soldOut = []) {
  const sold = new Set(soldOut)
  const prizes = prizeMap(config)
  const tally = new Map()
  for (const prize of config.prizes) {
    tally.set(prize.id, {
      id: prize.id,
      label: prize.label,
      brand: prize.brand,
      weight: Number(prize.weight) || 0,
      oncePerEvent: !!prize.oncePerEvent,
      slices: 0,
      tickets: 0,
      available: !sold.has(prize.id) && Number(prize.weight) > 0
    })
  }
  for (const id of config.slots) {
    const row = tally.get(id)
    if (!row) continue
    row.slices += 1
  }
  for (const slice of wheelTickets(config, soldOut)) {
    const row = tally.get(slice.id)
    if (row) row.tickets += slice.weight
  }
  const total = [...tally.values()].reduce((sum, row) => sum + row.tickets, 0)
  return [...tally.values()].map((row) => {
    const chance = total > 0 ? row.tickets / total : 0
    return {
      ...row,
      chance,
      oneIn: row.tickets > 0 ? Math.max(1, Math.round(total / row.tickets)) : null,
      percent: total > 0 ? (chance * 100).toFixed(2) : '0.00'
    }
  })
}
