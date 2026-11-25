import fs from 'node:fs'
import path from 'node:path'
import { cloneEntry, toCsv } from '../schema.js'

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

  async transaction(fn) {
    const run = this.chain.then(async () => {
      await this.reload()
      const list = this.cache.map((row) => cloneEntry(row))
      const result = await fn(list)
      await this.persist(list)
      this.cache = list.map((row) => cloneEntry(row))
      return result
    })
    this.chain = run.then(() => {}, () => {})
    return run
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
}
