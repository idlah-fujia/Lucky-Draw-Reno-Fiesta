/** Columns written to the Google Sheet and to data/entries.csv. One row per entry. */
export const COLUMNS = [
  'id',
  'code',
  'status',
  'event_slug',
  'event_name',
  'event_edition',
  'event_date',
  'homeowner_name',
  'homeowner_phone',
  'homeowner_email',
  'delivery_address',
  'designer_name',
  'designer_phone',
  'designer_email',
  'id_company',
  'proof_key',
  'proof_link',
  'proof_filename',
  'proof_mime',
  'proof_bytes',
  'prize_id',
  'prize_label',
  'prize_brand',
  'prize_slot',
  'decl_contract',
  'decl_genuine',
  'decl_verify',
  'decl_tnc',
  'code_email_status',
  'result_email_status',
  'created_at',
  'designer_saved_at',
  'spun_at',
  'verified_at',
  'voided_at',
  'updated_at'
]

export function emptyEntry() {
  const row = {}
  for (const key of COLUMNS) row[key] = ''
  return row
}

export function entryToRow(entry) {
  return COLUMNS.map((key) => (entry[key] == null ? '' : String(entry[key])))
}

export function rowToEntry(values) {
  const entry = emptyEntry()
  if (!values) return entry
  COLUMNS.forEach((key, index) => {
    const value = values[index]
    entry[key] = value == null ? '' : String(value)
  })
  return entry
}

export function cloneEntry(entry) {
  return { ...emptyEntry(), ...entry }
}

export function csvEscape(value) {
  let text = value == null ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function toCsv(entries) {
  const lines = [COLUMNS.join(',')]
  for (const entry of entries) {
    lines.push(entryToRow(entry).map(csvEscape).join(','))
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`
}
