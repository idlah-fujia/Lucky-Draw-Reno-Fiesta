import fs from 'node:fs'
import path from 'node:path'
import { claimConflicts } from '../claims.js'
import { generateCode } from '../codes.js'
import { HttpError } from '../http.js'
import { cloneEntry, toCsv } from '../schema.js'
import { sleep } from '../sheetHeader.js'

export class LocalStore {
  constructor(dir) {
    this.dir = dir
    this.file = path.join(dir, 'entries.json')
    this.csvFile = path.join(dir, 'entries.csv')
    this.mode = 'local'
    this.cache = []
    this.chain = Promise.resolve()
    this.kioskChain = Promise.resolve()
    this.userChain = Promise.resolve()
    this.kioskFile = path.join(dir, 'kiosk-qr.json')
    this.usersFile = path.join(dir, 'users.json')
    this.eventsFile = path.join(dir, 'events.json')
    this.eventChain = Promise.resolve()
    this.loaded = false
  }

  async ready() {
    await fs.promises.mkdir(this.dir, { recursive: true })
    await this.reload()
  }

  async reload() {
    await fs.promises.mkdir(this.dir, { recursive: true })
    if (!fs.existsSync(this.file)) {
      this.cache = []
      await this.persist(this.cache)
    } else {
      const raw = await fs.promises.readFile(this.file, 'utf8')
      const parsed = raw.trim() ? JSON.parse(raw) : []
      this.cache = parsed.map((row) => cloneEntry(row))
    }
    this.loaded = true
    return this.cache
  }

  async list() {
    if (!this.loaded) await this.reload()
    return this.cache.map((row) => cloneEntry(row))
  }

  async readFresh() {
    await this.reload()
    return this.cache.map((row) => cloneEntry(row))
  }

  async transaction(fn, options = {}) {
    const oncePerEventIds = options.oncePerEventIds || ['IPHONE']
    const run = this.chain.then(() => this.runClaim(fn, oncePerEventIds))
    this.chain = run.then(() => {}, () => {})
    return run
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
      await this.persist(list)
      const after = await this.readFresh()
      const lost = claimConflicts([...before.values()], list, after, { oncePerEventIds })
      if (!lost) {
        this.cache = list.map((row) => cloneEntry(row))
        return result
      }
      if (lost === 'code' && reissueCodes(list, after)) {
        await this.persist(list)
        const checked = await this.readFresh()
        if (!claimConflicts([...before.values()], list, checked, { oncePerEventIds })) {
          this.cache = list.map((row) => cloneEntry(row))
          return result
        }
      }
      if (lost === 'prize') {
        sawPrize = true
        restorePrizes(list, before, after, oncePerEventIds)
        await this.persist(list)
      }
      await sleep(40 * (attempt + 1))
    }
    throw new HttpError(409, sawPrize
      ? 'That top prize has already been won for this event.'
      : 'Please submit the form once more.')
  }

  async persist(list) {
    const json = JSON.stringify(list, null, 2)
    const tmp = `${this.file}.tmp`
    await fs.promises.writeFile(tmp, json)
    await fs.promises.rename(tmp, this.file)
    await fs.promises.writeFile(this.csvFile, toCsv(list.map((row) => cloneEntry(row))))
  }

  async readKioskQr() {
    try {
      const raw = await fs.promises.readFile(this.kioskFile, 'utf8')
      const parsed = raw.trim() ? JSON.parse(raw) : {}
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch (error) {
      if (error.code === 'ENOENT') return {}
      throw error
    }
  }

  async writeKioskQr(map) {
    await fs.promises.mkdir(this.dir, { recursive: true })
    const tmp = `${this.kioskFile}.tmp`
    await fs.promises.writeFile(tmp, JSON.stringify(map, null, 2))
    await fs.promises.rename(tmp, this.kioskFile)
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

  async readUsers() {
    try {
      const raw = await fs.promises.readFile(this.usersFile, 'utf8')
      const parsed = raw.trim() ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed : []
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
  }

  async writeUsers(list) {
    await fs.promises.mkdir(this.dir, { recursive: true })
    const tmp = `${this.usersFile}.tmp`
    await fs.promises.writeFile(tmp, JSON.stringify(list, null, 2))
    await fs.promises.rename(tmp, this.usersFile)
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

  async readEventFile() {
    try {
      const raw = await fs.promises.readFile(this.eventsFile, 'utf8')
      const parsed = raw.trim() ? JSON.parse(raw) : {}
      return {
        events: Array.isArray(parsed.events) ? parsed.events : [],
        live: typeof parsed.live === 'string' ? parsed.live : ''
      }
    } catch (error) {
      if (error.code === 'ENOENT') return { events: [], live: '' }
      throw error
    }
  }

  async writeEventFile(data) {
    await fs.promises.mkdir(this.dir, { recursive: true })
    const tmp = `${this.eventsFile}.tmp`
    await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2))
    await fs.promises.rename(tmp, this.eventsFile)
  }

  async listEvents() {
    return (await this.readEventFile()).events
  }

  async readLiveSlug() {
    return (await this.readEventFile()).live || ''
  }

  async updateEvents(fn) {
    const run = this.eventChain.then(async () => {
      const data = await this.readEventFile()
      await fn(data.events)
      await this.writeEventFile(data)
      return data.events
    })
    this.eventChain = run.then(() => {}, () => {})
    return run
  }

  async setLiveSlug(slug) {
    const run = this.eventChain.then(async () => {
      const data = await this.readEventFile()
      data.live = slug || ''
      await this.writeEventFile(data)
      return data.live
    })
    this.eventChain = run.then(() => {}, () => {})
    return run
  }
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
