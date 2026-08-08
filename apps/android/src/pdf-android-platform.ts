import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { PDFDocument, PDFName, PDFArray, degrees } from 'pdf-lib'
import type { DrawingInput, FormValueInput, MarkupInput, MetadataInput } from '../../pdf/src/shared/ipc'

export type AndroidPdfSession = { path: string; bytes: Uint8Array; name: string }

const PREFIX = 'android-pdf://'

const b64 = (bytes: Uint8Array): string => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(out)
}

const fromB64 = (value: string): Uint8Array => {
  const raw = atob(value)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export async function writePdfToDocuments(name: string, bytes: Uint8Array): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    const safe = (name.replace(/[\\/:*?"<>|]+/g, '_') || 'Document.pdf').replace(/\.pdf$/i, '') + '.pdf'
    const path = `GenOffice/${safe}`
    await Filesystem.writeFile({ path, directory: Directory.Documents, data: b64(bytes), recursive: true })
    const uri = await Filesystem.getUri({ path, directory: Directory.Documents })
    try { await Share.share({ title: safe, url: uri.uri, dialogTitle: 'Share PDF' }) } catch { /* share is optional */ }
    return { ok: true, path: `${PREFIX}${path}` }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function appendAnnot(doc: PDFDocument, page: any, annot: any): void {
  const existing = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
  if (existing) existing.push(annot)
  else page.node.set(PDFName.of('Annots'), doc.context.obj([annot]))
}

function quadBounds(q: number[]): [number, number, number, number] {
  const xs = [q[0] ?? 0, q[2] ?? 0, q[4] ?? 0, q[6] ?? 0]
  const ys = [q[1] ?? 0, q[3] ?? 0, q[5] ?? 0, q[7] ?? 0]
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

function addMarkup(doc: PDFDocument, page: any, m: MarkupInput): void {
  if (!m.quads.length) return
  const rect = m.quads.reduce((r, q) => {
    const b = quadBounds(q)
    return [Math.min(r[0], b[0]), Math.min(r[1], b[1]), Math.max(r[2], b[2]), Math.max(r[3], b[3])] as [number, number, number, number]
  }, quadBounds(m.quads[0]!))
  const subtype = m.type === 'highlight' ? 'Highlight' : m.type === 'underline' ? 'Underline' : 'StrikeOut'
  const annot = doc.context.obj({ Type: 'Annot', Subtype: subtype, Rect: rect, QuadPoints: m.quads.flat(), C: m.color, F: 4, P: page.ref })
  appendAnnot(doc, page, doc.context.register(annot))
}

function addDrawing(doc: PDFDocument, page: any, d: DrawingInput): void {
  if (d.kind === 'image') return
  if (d.kind === 'note') {
    const [x, y] = d.at
    const annot = doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [x, y - 18, x + 20, y], C: d.color, F: 4, P: page.ref })
    appendAnnot(doc, page, doc.context.register(annot))
    return
  }
  const ops: string[] = [`${d.width} w 1 J 1 j ${d.color[0]} ${d.color[1]} ${d.color[2]} RG`]
  let rect: [number, number, number, number]
  if (d.kind === 'rect' || d.kind === 'ellipse') {
    const [x1, y1, x2, y2] = d.rect
    rect = [Math.min(x1, x2) - 2, Math.min(y1, y2) - 2, Math.max(x1, x2) + 2, Math.max(y1, y2) + 2]
    if (d.kind === 'rect') ops.push(`${x1} ${y1} ${x2 - x1} ${y2 - y1} re S`)
    else {
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2, k = 0.5522848
      ops.push(`${cx + rx} ${cy} m`, `${cx + rx} ${cy + k * ry} ${cx + k * rx} ${cy + ry} ${cx} ${cy + ry} c`, `${cx - k * rx} ${cy + ry} ${cx - rx} ${cy + k * ry} ${cx - rx} ${cy} c`, `${cx - rx} ${cy - k * ry} ${cx - k * rx} ${cy - ry} ${cx} ${cy - ry} c`, `${cx + k * rx} ${cy - ry} ${cx + rx} ${cy - k * ry} ${cx + rx} ${cy} c`, 'S')
    }
  } else if (d.kind === 'ink') {
    const points = d.paths.flat()
    rect = [Math.min(...points.filter((_, i) => i % 2 === 0)) - 2, Math.min(...points.filter((_, i) => i % 2 === 1)) - 2, Math.max(...points.filter((_, i) => i % 2 === 0)) + 2, Math.max(...points.filter((_, i) => i % 2 === 1)) + 2]
    for (const path of d.paths) {
      if (path.length < 4) continue
      ops.push(`${path[0]} ${path[1]} m`)
      for (let i = 2; i < path.length; i += 2) ops.push(`${path[i]} ${path[i + 1]} l`)
      ops.push('S')
    }
  } else {
    const [x1, y1] = d.from, [x2, y2] = d.to
    rect = [Math.min(x1, x2) - 8, Math.min(y1, y2) - 8, Math.max(x1, x2) + 8, Math.max(y1, y2) + 8]
    ops.push(`${x1} ${y1} m ${x2} ${y2} l S`)
  }
  const ap = doc.context.stream(ops.join('\n'), { Type: 'XObject', Subtype: 'Form', BBox: rect })
  const annot = doc.context.obj({ Type: 'Annot', Subtype: d.kind === 'ink' ? 'Ink' : d.kind === 'ellipse' ? 'Circle' : d.kind === 'rect' ? 'Square' : 'Line', Rect: rect, C: d.color, F: 4, P: page.ref, AP: { N: doc.context.register(ap) } })
  appendAnnot(doc, page, doc.context.register(annot))
}

async function applyFormValues(doc: PDFDocument, values: FormValueInput[]): Promise<void> {
  if (!values.length) return
  const form = doc.getForm()
  for (const item of values) {
    try {
      const field = form.getField(item.name) as any
      if (item.kind === 'checkbox' && 'check' in field) item.checked ? field.check() : field.uncheck()
      else if (item.value !== undefined && 'setText' in field) field.setText(item.value)
      else if (item.value !== undefined && 'select' in field) field.select(item.value)
    } catch { /* missing/unsupported field: preserve the rest of the document */ }
  }
}

export async function savePdfBytes(source: Uint8Array, markups: MarkupInput[], drawings: DrawingInput[], forms: FormValueInput[], stamps: any[], rotations: { pageIndex: number; delta: number }[] = [], deletedPages: number[] = [], pageOrder?: number[], metadata?: MetadataInput): Promise<Uint8Array> {
  const doc = await PDFDocument.load(source, { ignoreEncryption: false })
  for (const m of markups) { const page = doc.getPages()[m.pageIndex]; if (page) addMarkup(doc, page, m) }
  for (const d of drawings) { const page = doc.getPages()[d.pageIndex]; if (page) addDrawing(doc, page, d) }
  await applyFormValues(doc, forms)
  if (metadata) {
    if (metadata.title !== undefined) doc.setTitle(metadata.title)
    if (metadata.author !== undefined) doc.setAuthor(metadata.author)
    if (metadata.subject !== undefined) doc.setSubject(metadata.subject)
    if (metadata.keywords !== undefined) doc.setKeywords(metadata.keywords.split(',').map((x) => x.trim()).filter(Boolean))
  }
  for (const r of rotations) { const page = doc.getPages()[r.pageIndex]; if (page) page.setRotation(degrees((page.getRotation().angle + r.delta) % 360)) }
  if (pageOrder && pageOrder.length) {
    const pages = doc.getPages()
    const keep = pageOrder.filter((i) => i >= 0 && i < pages.length).map((i) => pages[i]!)
    const out = await PDFDocument.create()
    const copied = await out.copyPages(doc, keep.map((p) => pages.indexOf(p)))
    copied.forEach((p) => out.addPage(p))
    return out.save()
  }
  if (deletedPages.length) {
    const remove = new Set(deletedPages)
    for (let i = doc.getPageCount() - 1; i >= 0; i--) if (remove.has(i) && doc.getPageCount() > 1) doc.removePage(i)
  }
  for (const stamp of stamps ?? []) {
    if (!stamp?.image || !Array.isArray(stamp.rect)) continue
    const page = doc.getPages()[stamp.pageIndex]
    if (!page) continue
    try {
      const png = await doc.embedPng(fromB64(stamp.image))
      const [x1, y1, x2, y2] = stamp.rect
      page.drawImage(png, { x: x1, y: y1, width: x2 - x1, height: y2 - y1, opacity: stamp.opacity ?? 1 })
    } catch { /* ignore unsupported stamp */ }
  }
  return doc.save({ useObjectStreams: true })
}

export async function savePdfSession(session: AndroidPdfSession, request: any): Promise<{ ok: boolean; error?: string; bytes?: Uint8Array }> {
  try {
    const bytes = await savePdfBytes(session.bytes, request.markups ?? [], request.drawings ?? [], request.formValues ?? [], request.stamps ?? [], request.rotations ?? [], request.deletedPages ?? [], request.pageOrder, request.metadata)
    return { ok: true, bytes }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export { PREFIX, fromB64 }
