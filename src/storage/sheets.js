import { createSign } from 'node:crypto'
import { COLUMNS, cloneEntry, entryToRow, rowToEntry } from '../schema.js'

const SHEET = 'Entries'
const KIOSK_SHEET = 'KioskQr'
const KIOSK_COLUMNS = ['event_slug', 'size', 'unit', 'position', 'updated_at']
const USERS_SHEET = 'users'
const USER_COLUMNS = ['id', 'name', 'email', 'role', 'password_hash', 'created_at', 'updated_at']
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
      throw new Error(`Google Sheets error ${response.status}: ${message}`)
    }
    return json
  }

  async ensureTab(title) {
    const meta = await this.sheets(`https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}?fields=sheets.properties.title`)
    const titles = (meta.sheets || []).map((sheet) => sheet.properties.title)
    if (!titles.includes(title)) {
      await this.sheets(`https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] })
      })
    }
  }

  async ensureSheet() {
    await this.ensureTab(SHEET)
  }

  async reload() {
    await this.ensureSheet()
    const range = encodeURIComponent(`${SHEET}!A1:AJ`)
    const data = await this.sheets(`https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${range}`)
    const values = data.values || []
    if (values.length === 0) {
      await this.writeRow(1, COLUMNS)
      this.cache = []
      this.loaded = true
      return this.cache
    }
    const header = values[0]
    const sameHeader = COLUMNS.every((key, index) => header[index] === key)
    if (!sameHeader) {
      throw new Error('The Entries tab already has a different header row. Rename that tab, or clear row 1, then restart. This app will write its own column names.')
    }
    this.cache = []
    this.rowNumbers = new Map()
    values.slice(1).forEach((row, index) => {
      const entry = rowToEntry(row)
      if (!entry.id) return
      this.cache.push(entry)
      this.rowNumbers.set(entry.id, index + 2)
    })
    this.loaded = true
    return this.cache
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

  async transaction(fn) {
    const run = this.chain.then(async () => {
      await this.reload()
      const before = new Map(this.cache.map((row) => [row.id, cloneEntry(row)]))
      const list = this.cache.map((row) => cloneEntry(row))
      const result = await fn(list)
      for (const entry of list) {
        const prev = before.get(entry.id)
        if (!prev) {
          const rowNumber = await this.append(entry)
          this.rowNumbers.set(entry.id, rowNumber)
        } else if (JSON.stringify(prev) !== JSON.stringify(entry)) {
          const rowNumber = this.rowNumbers.get(entry.id)
          if (!rowNumber) throw new Error(`Sheet row for ${entry.code || entry.id} was lost. Reload and try again.`)
          await this.writeRow(rowNumber, entryToRow(entry))
        }
      }
      this.cache = list.map((row) => cloneEntry(row))
      return result
    })
    this.chain = run.then(() => {}, () => {})
    return run
  }

  async readKioskQr() {
    await this.ensureTab(KIOSK_SHEET)
    const range = encodeURIComponent(`${KIOSK_SHEET}!A1:E`)
    const data = await this.sheets(`https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${range}`)
    const values = data.values || []
    if (values.length === 0) {
      await this.writeKioskRows([KIOSK_COLUMNS])
      return {}
    }
    const header = values[0]
    const sameHeader = KIOSK_COLUMNS.every((key, index) => header[index] === key)
    if (!sameHeader) {
      throw new Error('The KioskQr tab already has a different header row. Rename that tab, then restart. This app will write its own column names.')
    }
    const map = {}
    for (const row of values.slice(1)) {
      const slug = row[0]
      if (!slug) continue
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
    await this.ensureTab(USERS_SHEET)
    const range = encodeURIComponent(`${USERS_SHEET}!A1:G`)
    const data = await this.sheets(`https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${range}`)
    const values = data.values || []
    if (values.length === 0) {
      await this.writeUserRows([USER_COLUMNS])
      return []
    }
    const header = values[0]
    const sameHeader = USER_COLUMNS.every((key, index) => header[index] === key)
    if (!sameHeader) {
      throw new Error('The users tab already has a different header row. Rename that tab, then restart.')
    }
    return values.slice(1).filter((row) => row[0]).map((row) => ({
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
      const list = await this.readUsers()
      await fn(list)
      await this.writeUsers(list)
      return list
    })
    this.userChain = run.then(() => {}, () => {})
    return run
  }

  async updateKioskQr(eventKey, value) {
    const run = this.kioskChain.then(async () => {
      const map = await this.readKioskQr()
      map[eventKey] = value
      await this.writeKioskQr(map)
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
}

function columnLetter(count) {
  let n = count
  let letters = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    letters = String.fromCharCode(65 + rem) + letters
    n = Math.floor((n - 1) / 26)
  }
  return letters
}
