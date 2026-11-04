import { mkdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { Hono } from 'hono'
import sharp from 'sharp'
import { config } from './config.ts'
import { db } from './db.ts'

const ORIG = `${config.dataDir}/files/orig`
const SMALL = `${config.dataDir}/files/small`
mkdirSync(ORIG, { recursive: true })
mkdirSync(SMALL, { recursive: true })

export interface Attachment { id: number; entry_id: number; filename: string; mime: string; orig_path: string; small_path: string | null; caption: string; sent_to_llm: number }

export const attachmentsOf = (entryId: number) =>
  db.prepare('select * from attachments where entry_id = ? order by id').all(entryId) as unknown as Attachment[]

/** Keeps the original; images also get a 1600px JPEG (design.md §3.4) for the LLM, the web and the mirror. */
export async function saveUpload(entryId: number, filename: string, mime: string, bytes: Uint8Array) {
  const id = Number(db.prepare('insert into attachments (entry_id, filename, mime) values (?, ?, ?)').run(entryId, filename, mime).lastInsertRowid)
  const orig = `${ORIG}/${id}${extname(filename).replace(/[^.\w]/g, '').toLowerCase()}`
  await writeFile(orig, bytes)
  let small: string | null = `${SMALL}/${id}.jpg`
  try {
    await sharp(bytes).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(small)
  } catch {
    small = null // not an image sharp can read (video, PDF, CAD…): original only
  }
  db.prepare('update attachments set orig_path = ?, small_path = ? where id = ?').run(orig, small, id)
  return id
}

// Mounted behind requireUser. Originals always download (never rendered inline: the mime is client-supplied).
export const files = new Hono().get('/:id', async (c) => {
  const a = db.prepare('select * from attachments where id = ?').get(Number(c.req.param('id'))) as Attachment | undefined
  if (!a) return c.notFound()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Cache-Control', 'private, max-age=86400')
  if (a.small_path && !c.req.query('orig')) {
    c.header('Content-Type', 'image/jpeg')
    return c.body(await readFile(a.small_path))
  }
  c.header('Content-Type', 'application/octet-stream')
  c.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`)
  return c.body(await readFile(a.orig_path))
})
