import { createSign } from 'node:crypto'
import { claimConflicts } from '../claims.js'
import { generateCode } from '../codes.js'
import { HttpError } from '../http.js'
import { COLUMNS, cloneEntry, entryToRow, rowToEntry } from '../schema.js'
import { EVENT_COLUMNS, eventFromCells, eventNeedsDateBackfill, eventSheetColumns, normalizeStoredEvent } from '../events.js'
import { columnLetter, headerRange, normalizeHeader, reconcileHeader, rowHasData, rowIsDuplicateHeader, sleep } from '../sheetHeader.js'

const SHEET = 'Entries'
const KIOSK_SHEET = 'KioskQr'
const KIOSK_COLUMNS = ['event_slug', 'size', 'unit', 'position', 'updated_at']
const USERS_SHEET = 'users'
const USER_COLUMNS = ['id', 'name', 'email', 'role', 'password_hash', 'created_at', 'updated_at']
const EVENTS_SHEET = 'Events'
const SETTINGS_SHEET = 'Settings'
const SETTING_COLUMNS = ['key', 'value']
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

function privateKey() {
  let key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || ''
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1)
  }
  return key.replace(/\\n/g, '\n')
}

export function sheetsConfigured() {
  return !!(
    process.env.GOOGLE_SHEETS_ID &&
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  )
}

function b64url(value) {
  return Buffer.from(value).toString('base64url')
}

export class SheetsStore {
  constructor() {
    this.mode = 'sheets'
    this.spreadsheetId = process.env.GOOGLE_SHEETS_ID
    this.email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
    this.cache = []
    this.rowNumbers = new Map()
    this.chain = Promise.resolve()
    this.kioskChain = Promise.resolve()
    this.userChain = Promise.resolve()
    this.eventChain = Promise.resolve()
    this.prepared = new Set()
    this.memo = new Map()
    this.inflight = new Map()
    this.memoMs = 12_000
    this.loaded = false
    this.token = null
    this.tokenExp = 0
  }

  async ready() {
    await this.reload()
  }

  async accessToken() {
    const now = Math.floor(Date.now() / 1000)
    if (this.token && now < this.tokenExp - 60) return this.token
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const claim = b64url(JSON.stringify({
      iss: this.email,
      scope: SCOPE,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600
    }))
    const unsigned = `${header}.${claim}`
    const signer = createSign('RSA-SHA256')
    signer.update(unsigned)
    signer.end()
    let signature
    try {
      signature = signer.sign(privateKey()).toString('base64url')
    } catch {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is not a usable private key. Paste the private_key from the JSON file. Newlines can be written as \\n.')
    }
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`
    })
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    })
    const json = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(`Google refused the service account (${response.status}). ${json.error_description || json.error || 'Check the email and private key.'}`)
    }
    this.token = json.access_token
    this.tokenExp = now + (json.expires_in || 3600)
    return this.token
  }

  async sheets(url, options = {}) {
    let last
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this.sheetsOnce(url, options)
      } catch (error) {
        last = error
        if (!isSheetQuota(error) || attempt === 2) throw error
        const hinted = Number(error.retryAfterMs) || 0
        await sleep(Math.min(hinted || 1000 * 2 ** attempt, 8000))
      }
    }
    throw last
  }

  async sheetsOnce(url, options = {}) {
    const token = await this.accessToken()
    const response = await fetch(url, {
      ...options,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(options.headers || {})
      }
    })
    const text = await response.text()
    let json = {}
    if (text) {
      try { json = JSON.parse(text) } catch { json = { raw: text } }
    }
    if (!response.ok) {
      const message = json.error?.message || response.statusText
      if (response.status === 404) {
        throw new Error('That Google Sheet was not found. Check GOOGLE_SHEETS_ID. It is the long id in the sheet URL.')
      }
      if (response.status === 403) {
        throw new Error(`The sheet is not shared with ${this.email}. Share it as Editor and try again. (${message})`)
      }
      const error = new Error(`Google Sheets error ${response.status}: ${message}`)
      error.status = response.status
      const retryAfter = Number(response.headers.get('retry-after'))
      if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterMs = retryAfter * 1000
      throw error
    }
    return json
  }

  remember(key, value) {
    this.memo.set(key, { at: Date.now(), value: copyJson(value) })
  }

  recall(key, ttl = this.memoMs) {
    const hit = this.memo.get(key)
    if (!hit || Date.now() - hit.at > ttl) return null
    return copyJson(hit.value)
  }

  async memoRead(key, load, ttl = this.memoMs) {
    const hit = this.recall(key, ttl)
    if (hit) return hit
    if (this.inflight.has(key)) return copyJson(await this.inflight.get(key))
    const pending = (async () => {
      try {
        const value = await load()
        this.remember(key, value)
        return value
      } catch (error) {
        const stale = this.memo.get(key)
        if (stale && isSheetQuota(error)) return stale.value
        throw error
      } finally {
        this.inflight.delete(key)
      }
    })()
    this.inflight.set(key, pending)
    return copyJson(await pending)
  }

  async valuesFor(sheetName, columns) {
    if (!this.prepared.has(sheetName)) {
      const values = await this.ensureColumns(sheetName, columns)
      this.prepared.add(sheetName)
      return values
    }
    const values = await this.readGrid(sheetName)
    const decision = reconcileHeader(values[0] || [], columns)
    if (decision.action === 'ok') return values
    this.prepared.delete(sheetName)
    const fixed = await this.ensureColumns(sheetName, columns)
    this.prepared.add(sheetName)
    return fixed
  }

  async ensureTab(title) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const meta = await this.sheets(`https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}?fields=sheets.properties.title`)
      const titles = (meta.sheets || []).map((sheet) => sheet.properties.title)
      if (titles.includes(title)) return
      try {
        await this.sheets(`https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}:batchUpdate`, {
          method: 'POST',
          body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] })
        })
        return
      } catch (error) {
        if (!/already exists|duplicate/i.test(error.message || '') || attempt === 4) throw error
        await sleep(150 * 2 ** attempt)
      }
    }
  }

  async readGrid(sheetName) {
    const range = encodeURIComponent(`${sheetName}!${headerRange(COLUMNS.length)}`)
    const data = await this.sheets(`https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${range}`)
    return data.values || []
  }

  async writeHeader(sheetName, columns) {
    const end = columnLetter(columns.length)
    const range = encodeURIComponent(`${sheetName}!A1:${end}1`)
    await this.sheets(
      `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${range}?valueInputOption=RAW`,
      { method: 'PUT', body: JSON.stringify({ values: [columns] }) }
    )
  }

  /**
   * Open a tab and make row 1 match `columns`. A blank header is retried first,
   * in case the other service is writing it. A shorter older header grows at
   * the end. A wrong header is replaced only when the rows under it are empty
   * or are a second copy of the header.
   */
  async ensureColumns(sheetName, columns) {
    await this.ensureTab(sheetName)
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const values = await this.readGrid(sheetName)
      const decision = reconcileHeader(values[0] || [], columns)
      if (decision.action === 'ok') return values
      if (decision.action === 'write' && attempt < 4) {
        await sleep(150 * 2 ** attempt)
        continue
      }
      if (decision.action === 'extend') {
        console.log(`${sheetName} header is missing ${decision.missing.join(', ')}; adding those columns.`)
        await this.writeHeader(sheetName, columns)
        continue
      }
      if (decision.action === 'mismatch') {
        const real = values.slice(1).filter((row) => rowHasData(row) && !rowIsDuplicateHeader(row, decision.header) && !rowIsDuplicateHeader(row, columns))
        if (real.length) {
          throw new Error(`The ${sheetName} tab header doesn't match and it already has rows. Header: ${decision.header.join(', ')}`)
        }
        console.log(`${sheetName} header was ${decision.header.join(', ') || 'blank'}; writing the current columns. No entry rows were removed.`)
      }
      await this.writeHeader(sheetName, columns)
    }
    throw new Error(`Could not prepare the ${sheetName} tab. Restart in a moment.`)
  }

  async reload() {
    const values = await this.valuesFor(SHEET, COLUMNS)
    this.cache = []
    this.rowNumbers = new Map()
    values.slice(1).forEach((row, index) => {
      if (rowIsDuplicateHeader(row, values[0]) || rowIsDuplicateHeader(row, COLUMNS)) return
      const entry = rowToEntry(row)
      if (!entry.id) return
      this.cache.push(entry)
      this.rowNumbers.set(entry.id, index + 2)
    })
    this.loaded = true
    return this.cache
  }

  async readFresh() {
    await this.reload()
    return this.cache.map((row) => cloneEntry(row))
  }

  async writeRow(rowNumber, values) {
    const end = columnLetter(values.length)
    const range = encodeURIComponent(`${SHEET}!A${rowNumber}:${end}${rowNumber}`)
    await this.sheets(
      `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${range}?valueInputOption=RAW`,
      { method: 'PUT', body: JSON.stringify({ values: [values] }) }
    )
  }

  async list() {
    if (!this.loaded) await this.reload()
    return this.cache.map((row) => cloneEntry(row))
  }

  async transaction(fn, options = {}) {
    const oncePerEventIds = options.oncePerEventIds || ['IPHONE']
    const run = this.chain.then(() => this.runClaim(fn, oncePerEventIds))
    this.chain = run.then(() => {}, () => {})
    return run
  }

  async persistChanges(before, list) {
    for (const entry of list) {
      const prev = before.get(entry.id)
      const rowNumber = this.rowNumbers.get(entry.id)
      if (!prev && !rowNumber) {
        const appended = await this.append(entry)
        this.rowNumbers.set(entry.id, appended)
      } else if (!prev || JSON.stringify(prev) !== JSON.stringify(entry)) {
        if (!rowNumber) throw new Error(`Sheet row for ${entry.code || entry.id} was lost. Reload and try again.`)
        await this.writeRow(rowNumber, entryToRow(entry))
      }
    }
  }

  async runClaim(fn, oncePerEventIds) {
    let sawPrize = false
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await this.reload()
      const before = new Map(this.cache.map((row) => [row.id, cloneEntry(row)]))
      const list = this.cache.map((row) => cloneEntry(row))
      const result = await fn(list)
      const fresh = await this.readFresh()
      const conflict = claimConflicts([...before.values()], list, fresh, { oncePerEventIds })
      if (conflict) {
        await sleep(40 * (attempt + 1))
        continue
      }
      await this.persistChanges(before, list)
      const after = await this.readFresh()
      const lost = claimConflicts([...before.values()], list, after, { oncePerEventIds })
      if (!lost) {
        this.cache = list.map((row) => cloneEntry(row))
        return result
      }
      if (lost === 'code' && reissueCodes(list, after)) {
        await this.persistChanges(before, list)
        const checked = await this.readFresh()
        if (!claimConflicts([...before.values()], list, checked, { oncePerEventIds })) {
          this.cache = list.map((row) => cloneEntry(row))
          return result
        }
      }
      if (lost === 'prize') {
        sawPrize = true
        restorePrizes(list, before, after, oncePerEventIds)
        await this.persistChanges(before, list)
      }
      await sleep(40 * (attempt + 1))
    }
    throw new HttpError(409, sawPrize
      ? 'That top prize has already been won for this event.'
      : 'Please submit the form once more.')
  }

  async readKioskQr() {
    return this.memoRead('kiosk', () => this.loadKioskQr(), 25_000)
  }

  async loadKioskQr() {
    const values = await this.valuesFor(KIOSK_SHEET, KIOSK_COLUMNS)
    const map = {}
    for (const row of values.slice(1)) {
      const slug = row[0]
      if (!slug || slug === KIOSK_COLUMNS[0]) continue
      map[slug] = {
        size: Number(row[1]),
        unit: row[2] || '',
        position: row[3] || '',
        updatedAt: row[4] || ''
      }
    }
    return map
  }

  async writeKioskRows(rows) {
    const range = encodeURIComponent(`${KIOSK_SHEET}!A1`)
    await this.sheets(
      `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${range}?valueInputOption=RAW`,
      { method: 'PUT', body: JSON.stringify({ values: rows }) }
    )
  }

  async writeKioskQr(map) {
    await this.ensureTab(KIOSK_SHEET)
    const rows = [KIOSK_COLUMNS]
    for (const [slug, value] of Object.entries(map)) {
      rows.push([slug, String(value.size), value.unit, value.position, value.updatedAt || ''])
    }
    const clearRange = encodeURIComponent(`${KIOSK_SHEET}!A:E`)
    await this.sheets(
      `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${clearRange}:clear`,
      { method: 'POST' }
    )
    await this.writeKioskRows(rows)
  }

  async readUsers() {
    return this.memoRead('users', () => this.loadUsers())
  }

  async loadUsers() {
    const values = await this.valuesFor(USERS_SHEET, USER_COLUMNS)
    return values.slice(1).filter((row) => row[0] && row[0] !== USER_COLUMNS[0]).map((row) => ({
      id: row[0] || '',
      name: row[1] || '',
      email: row[2] || '',
      role: row[3] || '',
      password_hash: row[4] || '',
      created_at: row[5] || '',
      updated_at: row[6] || ''
    }))
  }

  async writeUserRows(rows) {
    const range = encodeURIComponent(`${USERS_SHEET}!A1`)
    await this.sheets(
      `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${range}?valueInputOption=RAW`,
      { method: 'PUT', body: JSON.stringify({ values: rows }) }
    )
  }

  async writeUsers(list) {
    await this.ensureTab(USERS_SHEET)
    const rows = [USER_COLUMNS, ...list.map((user) => USER_COLUMNS.map((key) => user[key] == null ? '' : String(user[key])))]
    const clearRange = encodeURIComponent(`${USERS_SHEET}!A:G`)
    await this.sheets(
      `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${clearRange}:clear`,
      { method: 'POST' }
    )
    await this.writeUserRows(rows)
  }

  async updateUsers(fn) {
    const run = this.userChain.then(async () => {
      const list = await this.loadUsers()
      await fn(list)
      await this.writeUsers(list)
      this.remember('users', list)
      return list
    })
    this.userChain = run.then(() => {}, () => {})
    return run
  }

  async updateKioskQr(eventKey, value) {
    const run = this.kioskChain.then(async () => {
      const map = await this.loadKioskQr()
      map[eventKey] = value
      await this.writeKioskQr(map)
      this.remember('kiosk', map)
      return map
    })
    this.kioskChain = run.then(() => {}, () => {})
    return run
  }

  async append(entry) {
    const range = encodeURIComponent(`${SHEET}!A1`)
    const json = await this.sheets(
      `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: 'POST', body: JSON.stringify({ values: [entryToRow(entry)] }) }
    )
    const updated = json.updates?.updatedRange || ''
    const match = updated.match(/![A-Z]+(\d+):/)
    return match ? Number(match[1]) : this.cache.length + 2
  }

  async listEvents() {
    return this.memoRead('events', () => this.loadEvents(), 25_000)
  }

  async loadEvents() {
    await this.ensureTab(EVENTS_SHEET)
    const peek = await this.readGrid(EVENTS_SHEET)
    const headerNow = normalizeHeader(peek[0] || [])
    const columns = eventSheetColumns(headerNow)
    const same = columns.length === headerNow.length && columns.every((name, index) => name === headerNow[index])
    const values = same ? peek : await this.valuesFor(EVENTS_SHEET, columns)
    const header = normalizeHeader(values[0] || columns)
    this.eventColumns = header.length ? header : columns
    let backfill = false
    const events = values.slice(1).filter((row) => row[0] && row[0] !== 'slug').map((row) => {
      if (eventNeedsDateBackfill(header, row)) backfill = true
      return eventFromCells(header, row)
    })
    if (backfill) await this.saveEvents(events)
    return events
  }

  async saveEvents(list) {
    await this.ensureTab(EVENTS_SHEET)
    const columns = this.eventColumns?.length ? this.eventColumns : EVENT_COLUMNS
    const rows = [columns, ...list.map((event) => columns.map((column) => eventCell(event, column)))]
    const clearRange = encodeURIComponent(`${EVENTS_SHEET}!A:${columnLetter(Math.max(columns.length, 8))}`)
    await this.sheets(
      `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${clearRange}:clear`,
      { method: 'POST' }
    )
    const range = encodeURIComponent(`${EVENTS_SHEET}!A1`)
    await this.sheets(
      `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${range}?valueInputOption=RAW`,
      { method: 'PUT', body: JSON.stringify({ values: rows }) }
    )
  }

  async updateEvents(fn) {
    const run = this.eventChain.then(async () => {
      const list = await this.loadEvents()
      await fn(list)
      await this.saveEvents(list)
      this.remember('events', list)
      return list
    })
    this.eventChain = run.then(() => {}, () => {})
    return run
  }

  async readSettings() {
    return this.memoRead('settings', () => this.loadSettings(), 25_000)
  }

  async loadSettings() {
    const values = await this.valuesFor(SETTINGS_SHEET, SETTING_COLUMNS)
    const map = {}
    for (const row of values.slice(1)) {
      if (!row[0] || row[0] === SETTING_COLUMNS[0]) continue
      map[row[0]] = row[1] || ''
    }
    return map
  }

  async writeSettings(map) {
    await this.ensureTab(SETTINGS_SHEET)
    const rows = [SETTING_COLUMNS, ...Object.entries(map).map(([key, value]) => [key, value == null ? '' : String(value)])]
    const clearRange = encodeURIComponent(`${SETTINGS_SHEET}!A:B`)
    await this.sheets(
      `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${clearRange}:clear`,
      { method: 'POST' }
    )
    const range = encodeURIComponent(`${SETTINGS_SHEET}!A1`)
    await this.sheets(
      `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${range}?valueInputOption=RAW`,
      { method: 'PUT', body: JSON.stringify({ values: rows }) }
    )
  }

  async readLiveSlug() {
    const map = await this.readSettings()
    return map.live_event || ''
  }

  async readArchived() {
    const map = await this.readSettings()
    try {
      const parsed = JSON.parse(map.archived_events || '[]')
      return Array.isArray(parsed) ? parsed.filter(Boolean) : []
    } catch {
      return []
    }
  }

  async setArchived(slug, archived) {
    const run = this.eventChain.then(async () => {
      const map = await this.loadSettings()
      let list = []
      try {
        const parsed = JSON.parse(map.archived_events || '[]')
        list = Array.isArray(parsed) ? parsed : []
      } catch {
        list = []
      }
      const set = new Set(list.filter(Boolean))
      if (archived) set.add(slug)
      else set.delete(slug)
      map.archived_events = JSON.stringify([...set])
      await this.writeSettings(map)
      this.remember('settings', map)
      return [...set]
    })
    this.eventChain = run.then(() => {}, () => {})
    return run
  }

  async setLiveSlug(slug) {
    const run = this.eventChain.then(async () => {
      const map = await this.loadSettings()
      map.live_event = slug || ''
      await this.writeSettings(map)
      this.remember('settings', map)
      return map.live_event
    })
    this.eventChain = run.then(() => {}, () => {})
    return run
  }
}

function eventCell(event, column) {
  const normalized = normalizeStoredEvent(event)
  if (column === 'slug') return normalized.slug || ''
  if (column === 'name') return normalized.name || ''
  if (column === 'date') return normalized.date || normalized.starts || ''
  if (column === 'starts') return normalized.starts || ''
  if (column === 'ends') return normalized.ends || ''
  if (column === 'edition') return normalized.edition || ''
  if (column === 'active') return normalized.active === false ? 'no' : 'yes'
  if (column === 'created_at') return normalized.created_at || ''
  if (column === 'created_by') return normalized.created_by || ''
  if (column === 'mode') return normalized.mode || ''
  const value = normalized[column]
  return value == null ? '' : String(value)
}

export function isSheetQuota(error) {
  if (!error || error instanceof HttpError) return false
  return error.status === 429 || /quota|rate limit|429/i.test(error.message || '')
}

function copyJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function reissueCodes(list, fresh) {
  const used = new Set((fresh || []).map((row) => row.code).filter(Boolean))
  let changed = false
  for (const row of list) {
    const clash = (fresh || []).find((other) => other.id !== row.id && other.code === row.code && other.status !== 'voided')
    if (!clash) continue
    let code = row.code
    for (let n = 0; n < 8; n += 1) {
      code = generateCode()
      if (!used.has(code)) break
    }
    used.add(code)
    row.code = code
    changed = true
  }
  return changed
}

function restorePrizes(list, before, fresh, oncePerEventIds) {
  const limited = new Set(oncePerEventIds)
  for (const row of list) {
    const prev = before.get(row.id)
    if (!row.prize_id || !limited.has(row.prize_id)) continue
    if (prev && prev.prize_id === row.prize_id) continue
    const taken = (fresh || []).find((other) =>
      other.id !== row.id &&
      other.event_slug === row.event_slug &&
      other.prize_id === row.prize_id &&
      other.status !== 'voided'
    )
    if (!taken) continue
    row.prize_id = prev?.prize_id || ''
    row.prize_label = prev?.prize_label || ''
    row.prize_brand = prev?.prize_brand || ''
    row.prize_slot = prev?.prize_slot || ''
    row.spun_at = prev?.spun_at || ''
    row.status = prev?.status || 'submitted'
    row.updated_at = prev?.updated_at || row.updated_at
  }
}
