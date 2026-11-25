import fs from 'node:fs'
import path from 'node:path'
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'

export function r2Configured() {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET
  )
}

export function openFiles() {
  if (r2Configured()) return new R2Files()
  const dir = path.resolve(process.env.DATA_DIR || './data', 'uploads')
  return new LocalFiles(dir)
}

export class LocalFiles {
  constructor(dir) {
    this.dir = dir
    this.mode = 'local'
  }

  async ready() {
    await fs.promises.mkdir(this.dir, { recursive: true })
  }

  filePath(id) {
    return path.join(this.dir, id)
  }

  async save(id, { buffer, contentType }) {
    await this.ready()
    const target = this.filePath(id)
    const tmp = `${target}.tmp`
    await fs.promises.writeFile(tmp, buffer)
    await fs.promises.rename(tmp, target)
    await fs.promises.writeFile(`${target}.meta.json`, JSON.stringify({ contentType }))
  }

  async read(id) {
    const target = this.filePath(id)
    if (!fs.existsSync(target)) return null
    const buffer = await fs.promises.readFile(target)
    let contentType = 'application/octet-stream'
    try {
      const meta = JSON.parse(await fs.promises.readFile(`${target}.meta.json`, 'utf8'))
      if (meta.contentType) contentType = meta.contentType
    } catch { /* meta is optional */ }
    return { buffer, contentType }
  }

  async remove(id) {
    await fs.promises.rm(this.filePath(id), { force: true })
    await fs.promises.rm(`${this.filePath(id)}.meta.json`, { force: true })
  }
}

class R2Files {
  constructor() {
    this.mode = 'r2'
    this.bucket = process.env.R2_BUCKET
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
      }
    })
  }

  async ready() {}

  key(id) {
    return `proofs/${id}`
  }

  async save(id, { buffer, contentType }) {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.key(id),
      Body: buffer,
      ContentType: contentType
    }))
  }

  async read(id) {
    try {
      const result = await this.client.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.key(id)
      }))
      const bytes = await result.Body.transformToByteArray()
      return {
        buffer: Buffer.from(bytes),
        contentType: result.ContentType || 'application/octet-stream'
      }
    } catch (error) {
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) return null
      throw error
    }
  }

  async remove(id) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(id) }))
  }
}
