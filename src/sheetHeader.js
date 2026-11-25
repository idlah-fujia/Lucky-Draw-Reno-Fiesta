/** Header checks for a sheet that two services may open at the same time. */

export function columnLetter(count) {
  let n = count
  let letters = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    letters = String.fromCharCode(65 + rem) + letters
    n = Math.floor((n - 1) / 26)
  }
  return letters
}

/** Wide enough to see columns added after the old A:AJ read (36 columns). */
export function headerRange(columnCount) {
  return `A1:${columnLetter(Math.max(columnCount, 52))}`
}

export function normalizeHeader(row) {
  const header = (row || []).map((cell) => String(cell ?? '').trim())
  while (header.length && header[header.length - 1] === '') header.pop()
  return header
}

/**
 * `ok` — the stored header already starts with the columns this version needs.
 * `extend` — it is an older prefix; append the missing names at the end.
 * `write` — row 1 is blank, so this process may write the header.
 * `mismatch` — the names are not ours. Callers rewrite row 1 only when no real data is underneath.
 */
export function reconcileHeader(actual, expected) {
  const header = normalizeHeader(actual)
  if (!header.length) return { action: 'write', header }
  const prefix = expected.every((key, index) => header[index] === key)
  if (prefix && header.length >= expected.length) return { action: 'ok', header }
  if (header.length < expected.length && header.every((key, index) => key === expected[index])) {
    return { action: 'extend', header, missing: expected.slice(header.length) }
  }
  return { action: 'mismatch', header }
}

export function rowHasData(row) {
  return (row || []).some((cell) => String(cell ?? '').trim() !== '')
}

/** A second copy of the column names, left behind when two startups wrote row 1 together. */
export function rowIsDuplicateHeader(row, header) {
  const cells = (row || []).map((cell) => String(cell ?? '').trim())
  if (!header?.length || !cells.some(Boolean)) return false
  return header.every((key, index) => cells[index] === key)
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
