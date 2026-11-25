/**
 * Compare an unsaved edit with a fresh copy of the rows.
 * `code` means another row already has this new code.
 * `prize` means another live row already won this once-per-event prize.
 * Our own row (same id) does not count, so a check after our write still passes.
 */
export function claimConflicts(before, proposed, fresh, { oncePerEventIds = ['IPHONE'] } = {}) {
  const previous = new Map((before || []).map((row) => [row.id, row]))
  const limited = new Set(oncePerEventIds)
  for (const row of proposed || []) {
    const prev = previous.get(row.id)
    if (!prev && row.code) {
      const clash = (fresh || []).find((other) =>
        other.id !== row.id && other.code === row.code && other.status !== 'voided'
      )
      if (clash) return 'code'
    }
    const awarded = row.prize_id && limited.has(row.prize_id) && (!prev || prev.prize_id !== row.prize_id)
    if (awarded) {
      const taken = (fresh || []).find((other) =>
        other.id !== row.id &&
        other.event_slug === row.event_slug &&
        other.prize_id === row.prize_id &&
        other.status !== 'voided'
      )
      if (taken) return 'prize'
    }
  }
  return null
}
