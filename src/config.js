import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { oddsTable } from './prizes.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const configPath = path.join(root, 'config', 'spin.config.json')

let cached = null
let cachedMtime = 0

export function validateConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('Config must be a JSON object.')
  if (!Array.isArray(config.events) || config.events.length === 0) {
    throw new Error('Config needs at least one event.')
  }
  const slugs = new Set()
  for (const event of config.events) {
    if (!/^[a-z0-9-]{2,60}$/.test(event.slug || '')) {
      throw new Error(`Event slug “${event.slug}” must be lowercase letters, numbers and hyphens.`)
    }
    if (slugs.has(event.slug)) throw new Error(`Duplicate event slug ${event.slug}.`)
    slugs.add(event.slug)
    if (!event.name) throw new Error(`Event ${event.slug} needs a name.`)
    if (event.starts && !/^\d{4}-\d{2}-\d{2}$/.test(event.starts)) {
      throw new Error(`Event ${event.slug} starts must be YYYY-MM-DD.`)
    }
    if (event.ends && !/^\d{4}-\d{2}-\d{2}$/.test(event.ends)) {
      throw new Error(`Event ${event.slug} ends must be YYYY-MM-DD.`)
    }
  }
  if (!Array.isArray(config.prizes) || config.prizes.length === 0) {
    throw new Error('Config needs a prizes list.')
  }
  const ids = new Set()
  for (const prize of config.prizes) {
    if (!prize.id || ids.has(prize.id)) throw new Error(`Bad or duplicate prize id ${prize.id}.`)
    ids.add(prize.id)
    if (!prize.label || !prize.brand) throw new Error(`Prize ${prize.id} needs a label and a brand.`)
    if (!Number.isFinite(Number(prize.weight)) || Number(prize.weight) < 0) {
      throw new Error(`Prize ${prize.id} weight must be a number, 0 or more.`)
    }
  }
  if (!Array.isArray(config.slots) || config.slots.length !== 32) {
    throw new Error('slots must be exactly 32 prize ids, in the same order as the wheel artwork.')
  }
  for (const id of config.slots) {
    if (!ids.has(id)) throw new Error(`Slot prize “${id}” is not in the prizes list.`)
  }
  return config
}

export function getConfig() {
  const stat = fs.statSync(configPath)
  if (cached && stat.mtimeMs === cachedMtime) return cached
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    cached = validateConfig(parsed)
    cachedMtime = stat.mtimeMs
    return cached
  } catch (error) {
    if (cached) {
      console.error('Config file is invalid. Keeping the last good copy.', error.message)
      return cached
    }
    throw error
  }
}

export function publicEvent(event) {
  return {
    slug: event.slug,
    name: event.name,
    edition: event.edition || '',
    starts: event.starts || '',
    ends: event.ends || '',
    active: !!event.active
  }
}

export function findEvent(config, slug) {
  return config.events.find((event) => event.slug === slug) || null
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  try {
    const config = getConfig()
    console.log(`Config OK. ${config.events.length} events, ${config.prizes.length} prizes, ${config.slots.length} slices.`)
    console.log('Placeholder odds while every prize is still available:')
    for (const row of oddsTable(config, [])) {
      const availability = row.available ? `${row.percent}% (about 1 in ${row.oneIn})` : 'off the wheel'
      console.log(`  ${row.label}: ${row.slices} slice(s), weight ${row.weight} each — ${availability}`)
    }
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
