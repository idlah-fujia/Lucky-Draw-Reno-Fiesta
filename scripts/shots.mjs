import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright-core'

const base = process.env.BASE_URL || 'http://127.0.0.1:47231'
const outDir = path.resolve('docs/screenshots')
const artDir = '/opt/cursor/artifacts'
fs.mkdirSync(outDir, { recursive: true })
fs.mkdirSync(artDir, { recursive: true })

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const proof = '/tmp/sure-win-receipt.png'
fs.writeFileSync(proof, png)

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']
})

const errors = []
function watch(page) {
  page.on('pageerror', (err) => errors.push(err.message))
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()) })
}

async function shot(page, name, fullPage = false) {
  const file = path.join(outDir, `${name}.png`)
  await page.screenshot({ path: file, fullPage })
  fs.copyFileSync(file, path.join(artDir, `${name}.png`))
  console.log('saved', name)
}

const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } })
watch(desktop)
await desktop.goto(`${base}/e/reno-fiesta-nov-2026`, { waitUntil: 'networkidle' })
await desktop.waitForSelector('#wheel svg')
await desktop.waitForSelector('.event-lock')
const eventText = await desktop.locator('.event-lock b').innerText()
if (!eventText.includes('Reno Fiesta')) throw new Error(`event lock: ${eventText}`)
await shot(desktop, 'page1-form', true)

await desktop.locator('[name=homeowner_name]').fill('Mei Lin Tan')
await desktop.locator('[name=homeowner_phone]').fill('81234567')
await desktop.locator('[name=homeowner_email]').fill('mei.lin@example.com')
await desktop.locator('[name=delivery_address]').fill('10 Example Road #04-02 Singapore 123456')
await desktop.locator('#proof').setInputFiles(proof)
await desktop.locator('[name=decl_contract]').check()
await desktop.locator('[name=decl_genuine]').check()
await desktop.locator('[name=decl_verify]').check()
await desktop.locator('[name=tnc]').check()
await desktop.locator('#go').click()
await desktop.waitForSelector('[data-testid=spin-code]')
const code = (await desktop.locator('[data-testid=spin-code] b').innerText()).replace(/\s/g, '')
if (!/^[A-Z0-9]{8}$/.test(code)) throw new Error(`bad code ${code}`)
const saveCopy = await desktop.locator('.save-banner').innerText()
if (!/screenshot/i.test(saveCopy)) throw new Error(saveCopy)
await shot(desktop, 'page1-code', true)
console.log('code', code)

const phone = await browser.newPage({ viewport: { width: 390, height: 844 } })
watch(phone)
await phone.goto(`${base}/e/homefest-2026`, { waitUntil: 'networkidle' })
await phone.waitForSelector('#formCard')
await phone.locator('#formCard').scrollIntoViewIfNeeded()
await shot(phone, 'page1-mobile', false)

const kiosk = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
watch(kiosk)
await kiosk.goto(`${base}/spin?event=reno-fiesta-nov-2026`, { waitUntil: 'networkidle' })
await kiosk.waitForSelector('#wheel svg')
await kiosk.waitForSelector('[data-testid=code-boxes]')
await shot(kiosk, 'kiosk-code')

for (const ch of code) await kiosk.locator(`[data-key="${ch}"]`).click()
await kiosk.locator('[data-testid=check-code]').click()
await kiosk.waitForSelector('[data-testid=code-verified]')
await kiosk.locator('[name=designer_name]').click()
await kiosk.waitForSelector('#osk button')
await shot(kiosk, 'kiosk-designer')
await kiosk.locator('[name=designer_name]').fill('Alicia Ong')
await kiosk.locator('[name=designer_phone]').fill('62345678')
await kiosk.locator('[name=designer_email]').fill('alicia@studio.example')
await kiosk.locator('[name=id_company]').fill('Studio Example')
await kiosk.locator('[data-testid=save-designer]').click()
await kiosk.waitForSelector('[data-testid=wheel-unlocked]')
const spinLabel = await kiosk.locator('#spinBtn').innerText()
if (!/spin now/i.test(spinLabel)) throw new Error(spinLabel)
await shot(kiosk, 'kiosk-wheel')

await kiosk.locator('#spinBtn').click({ force: true })
await kiosk.waitForTimeout(700)
await shot(kiosk, 'kiosk-spinning')
await kiosk.waitForSelector('#modal.show', { timeout: 12000 })
const title = await kiosk.locator('#resTitle').innerText()
if (!/won/i.test(title)) throw new Error(title)
await shot(kiosk, 'kiosk-result')

await kiosk.locator('#nextBtn').click()
await kiosk.waitForSelector('[data-testid=code-boxes]')
for (const ch of code) await kiosk.locator(`[data-key="${ch}"]`).click()
await kiosk.locator('[data-testid=check-code]').click()
await kiosk.waitForSelector('#modal.show')
const kicker = await kiosk.locator('#resKicker').innerText()
if (!/already/i.test(kicker)) throw new Error(kicker)
await shot(kiosk, 'kiosk-already')

const admin = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
watch(admin)
await admin.goto(`${base}/admin`, { waitUntil: 'networkidle' })
await admin.locator('#password').fill(process.env.ADMIN_PASSWORD || 'spin-local-admin')
await admin.locator('#loginForm button[type=submit]').click()
await admin.waitForSelector('[data-testid=row-code]')
const shown = (await admin.locator('[data-testid=row-code]').first().innerText()).trim()
if (shown !== code) throw new Error(`admin showed ${shown}, expected ${code}`)
await admin.waitForFunction(() => {
  const img = document.querySelector('.qr-card img')
  return img && img.complete && img.naturalWidth > 100
})
const qrWidth = await admin.locator('.qr-card img').first().evaluate((img) => img.naturalWidth)
if (qrWidth < 100) throw new Error(`qr width ${qrWidth}`)
await admin.locator('[data-act=toggle]').first().click()
await shot(admin, 'admin', true)

const unexpected = errors.filter((message) => !/401/.test(message))
if (unexpected.length) {
  console.error('page errors', unexpected)
  throw new Error(unexpected[0])
}
await browser.close()
console.log('flow ok', code)
