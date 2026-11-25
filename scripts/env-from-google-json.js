import fs from 'node:fs'

const file = process.argv[2]
const sheetId = process.argv[3] || ''
if (!file) {
  console.error('Usage: node scripts/env-from-google-json.js path/to/service-account.json [SPREADSHEET_ID]')
  process.exit(1)
}
const json = JSON.parse(fs.readFileSync(file, 'utf8'))
if (!json.client_email || !json.private_key) {
  console.error('That file does not look like a Google service-account key.')
  process.exit(1)
}
const key = json.private_key.replace(/\n/g, '\\n')
console.log('')
console.log('# Paste these into .env, then restart the server.')
console.log(`GOOGLE_SHEETS_ID=${sheetId}`)
console.log(`GOOGLE_SERVICE_ACCOUNT_EMAIL=${json.client_email}`)
console.log(`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="${key}"`)
console.log('')
console.log(`Share the Google Sheet with ${json.client_email} as Editor.`)
console.log('Do not email this output or commit it. It is a password for the sheet.')
