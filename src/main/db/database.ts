import initSqlJs, { Database } from 'sql.js'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

let db: Database
const dbPath = path.join(app.getPath('userData'), 'whatsapp_bulk.sqlite')

export async function initDatabase() {
  const wasmPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
    : path.resolve(__dirname, '../../node_modules/sql.js/dist/sql-wasm.wasm')
  try {
    const SQL = await initSqlJs({ locateFile: (f: string) => f === 'sql-wasm.wasm' ? wasmPath : f })
    db = fs.existsSync(dbPath) ? new SQL.Database(fs.readFileSync(dbPath)) : new SQL.Database()
    createTables()
    runMigrations()
    saveDatabase()
    console.log('[DB] Ready')
  } catch (err: any) {
    console.error('[DB] Failed:', err.message)
    throw err
  }
}

function createTables() {
  // Accounts table (v2)
  db.run(`CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    phone TEXT,
    daily_limit INTEGER DEFAULT 200,
    daily_sent INTEGER DEFAULT 0,
    last_reset_date TEXT,
    warmup_enabled INTEGER DEFAULT 0,
    warmup_day INTEGER DEFAULT 1,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`)

  // Contacts table with extra_data for mail merge
  db.run(`CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE,
    name TEXT,
    extra_data TEXT DEFAULT '{}',
    status TEXT DEFAULT 'pending',
    is_whatsapp INTEGER DEFAULT NULL,
    verified_at DATETIME,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    message TEXT,
    media_path TEXT,
    media_type TEXT,
    media_caption TEXT,
    total_contacts INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    last_sent_phone TEXT,
    status TEXT DEFAULT 'draft',
    scheduled_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER,
    campaign_name TEXT,
    account_id TEXT,
    phone TEXT,
    name TEXT,
    message_sent TEXT,
    status TEXT,
    error TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(campaign_id) REFERENCES campaigns(id)
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS blacklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE,
    reason TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS unsubscribes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE,
    account_id TEXT,
    keyword TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`)
}

function runMigrations() {
  // Add columns introduced in v2 if they don't exist (for users upgrading)
  const safeAdd = (table: string, col: string, def: string) => {
    try { db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`) } catch (_) {}
  }
  safeAdd('contacts', 'extra_data', "TEXT DEFAULT '{}'")
  safeAdd('contacts', 'is_whatsapp', 'INTEGER DEFAULT NULL')
  safeAdd('contacts', 'verified_at', 'DATETIME')
  safeAdd('campaigns', 'media_path', 'TEXT')
  safeAdd('campaigns', 'media_type', 'TEXT')
  safeAdd('campaigns', 'media_caption', 'TEXT')
  safeAdd('campaigns', 'scheduled_at', 'DATETIME')
  safeAdd('logs', 'account_id', 'TEXT')
  safeAdd('logs', 'name', 'TEXT')
  safeAdd('logs', 'message_sent', 'TEXT')
}

export function saveDatabase() {
  fs.writeFileSync(dbPath, Buffer.from(db.export()))
}

function toRows(res: any[]): Record<string, any>[] {
  if (res.length === 0) return []
  const cols = res[0].columns
  return res[0].values.map((row: any[]) => {
    const obj: Record<string, any> = {}
    cols.forEach((c: string, i: number) => { obj[c] = row[i] })
    return obj
  })
}

// ── Accounts ──────────────────────────────────────────────────────────────────
export function getAccounts() {
  return toRows(db.exec('SELECT * FROM accounts ORDER BY created_at ASC'))
}

export function upsertAccount(id: string, label: string, phone?: string) {
  db.run(`INSERT INTO accounts (id, label, phone) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET label=excluded.label, phone=COALESCE(excluded.phone, phone)`,
    [id, label, phone || null])
  saveDatabase()
}

export function updateAccountPhone(id: string, phone: string) {
  db.run('UPDATE accounts SET phone = ? WHERE id = ?', [phone, id])
  saveDatabase()
}

export function updateAccountDailySent(id: string, sent: number) {
  db.run('UPDATE accounts SET daily_sent = ? WHERE id = ?', [sent, id])
  saveDatabase()
}

export function resetAccountDailySent(id: string) {
  db.run("UPDATE accounts SET daily_sent = 0, last_reset_date = date('now') WHERE id = ?", [id])
  saveDatabase()
}

export function updateAccountDailyLimit(id: string, limit: number) {
  db.run('UPDATE accounts SET daily_limit = ? WHERE id = ?', [limit, id])
  saveDatabase()
}

export function deleteAccount(id: string) {
  db.run('DELETE FROM accounts WHERE id = ?', [id])
  saveDatabase()
}

// ── Contacts ──────────────────────────────────────────────────────────────────
export function addContacts(contacts: { phone: string; name?: string; extra_data?: Record<string, any> }[]) {
  const stmt = db.prepare('INSERT OR IGNORE INTO contacts (phone, name, extra_data) VALUES (?, ?, ?)')
  for (const c of contacts) {
    stmt.run([c.phone, c.name || null, JSON.stringify(c.extra_data || {})])
  }
  stmt.free()
  saveDatabase()
}

export function getContacts() {
  const rows = toRows(db.exec('SELECT * FROM contacts ORDER BY added_at DESC'))
  return rows.map(r => ({
    ...r,
    extra_data: (() => { try { return JSON.parse(r.extra_data || '{}') } catch { return {} } })()
  }))
}

export function updateContactVerification(phone: string, isWhatsapp: boolean) {
  db.run("UPDATE contacts SET is_whatsapp = ?, verified_at = datetime('now') WHERE phone = ?",
    [isWhatsapp ? 1 : 0, phone])
  saveDatabase()
}

export function updateContactStatus(phone: string, status: string) {
  db.run('UPDATE contacts SET status = ? WHERE phone = ?', [status, phone])
  saveDatabase()
}

export function clearContacts() {
  db.run('DELETE FROM contacts')
  saveDatabase()
}

// ── Campaigns ──────────────────────────────────────────────────────────────────
export function createCampaign(name: string, message: string, totalContacts: number,
  mediaPath?: string, mediaType?: string, mediaCaption?: string, scheduledAt?: string): number {
  db.run(`INSERT INTO campaigns (name, message, total_contacts, media_path, media_type, media_caption, scheduled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name, message, totalContacts, mediaPath || null, mediaType || null, mediaCaption || null, scheduledAt || null])
  const res = db.exec('SELECT last_insert_rowid() as id')
  saveDatabase()
  return res[0].values[0][0] as number
}

export function getCampaigns() {
  return toRows(db.exec('SELECT * FROM campaigns ORDER BY created_at DESC'))
}

export function updateCampaign(id: number, data: {
  sentCount?: number; failedCount?: number; status?: string
  lastSentPhone?: string; completedAt?: string
}) {
  const parts: string[] = []
  const vals: any[] = []
  if (data.sentCount !== undefined) { parts.push('sent_count = ?'); vals.push(data.sentCount) }
  if (data.failedCount !== undefined) { parts.push('failed_count = ?'); vals.push(data.failedCount) }
  if (data.status !== undefined) { parts.push('status = ?'); vals.push(data.status) }
  if (data.lastSentPhone !== undefined) { parts.push('last_sent_phone = ?'); vals.push(data.lastSentPhone) }
  if (data.completedAt !== undefined) { parts.push('completed_at = ?'); vals.push(data.completedAt) }
  if (!parts.length) return
  vals.push(id)
  db.run(`UPDATE campaigns SET ${parts.join(', ')} WHERE id = ?`, vals)
  saveDatabase()
}

export function deleteCampaign(id: number) {
  db.run('DELETE FROM logs WHERE campaign_id = ?', [id])
  db.run('DELETE FROM campaigns WHERE id = ?', [id])
  saveDatabase()
}

// ── Logs ──────────────────────────────────────────────────────────────────────
export function addLog(campaignId: number, campaignName: string, phone: string, status: string,
  error?: string, accountId?: string, name?: string, messageSent?: string) {
  db.run(`INSERT INTO logs (campaign_id, campaign_name, account_id, phone, name, message_sent, status, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [campaignId, campaignName, accountId || null, phone, name || null, messageSent || null, status, error || null])
  saveDatabase()
}

export function getLogs(campaignId?: number) {
  const sql = campaignId
    ? 'SELECT * FROM logs WHERE campaign_id = ? ORDER BY timestamp DESC LIMIT 1000'
    : 'SELECT * FROM logs ORDER BY timestamp DESC LIMIT 1000'
  return toRows(db.exec(sql, campaignId ? [campaignId] : []))
}

export function getLogsForExport(campaignId?: number) {
  const sql = campaignId
    ? 'SELECT * FROM logs WHERE campaign_id = ? ORDER BY timestamp ASC'
    : 'SELECT * FROM logs ORDER BY timestamp ASC'
  return toRows(db.exec(sql, campaignId ? [campaignId] : []))
}

export function clearLogs() {
  db.run('DELETE FROM logs')
  saveDatabase()
}

// ── Blacklist ──────────────────────────────────────────────────────────────────
export function addToBlacklist(phones: string[], reason = 'manual') {
  const stmt = db.prepare('INSERT OR IGNORE INTO blacklist (phone, reason) VALUES (?, ?)')
  for (const p of phones) stmt.run([p, reason])
  stmt.free()
  saveDatabase()
}

export function getBlacklist(): string[] {
  return toRows(db.exec('SELECT phone FROM blacklist')).map((r: any) => r.phone)
}

export function removeFromBlacklist(phone: string) {
  db.run('DELETE FROM blacklist WHERE phone = ?', [phone])
  saveDatabase()
}

export function clearBlacklist() {
  db.run('DELETE FROM blacklist')
  saveDatabase()
}

// ── Templates ──────────────────────────────────────────────────────────────────
export function saveTemplate(name: string, message: string) {
  db.run('INSERT INTO templates (name, message) VALUES (?, ?)', [name, message])
  saveDatabase()
}

export function getTemplates() {
  return toRows(db.exec('SELECT * FROM templates ORDER BY created_at DESC'))
}

export function deleteTemplate(id: number) {
  db.run('DELETE FROM templates WHERE id = ?', [id])
  saveDatabase()
}

// ── Unsubscribes ──────────────────────────────────────────────────────────────
export function addUnsubscribe(phone: string, accountId: string, keyword: string) {
  db.run('INSERT OR IGNORE INTO unsubscribes (phone, account_id, keyword) VALUES (?, ?, ?)',
    [phone, accountId, keyword])
  // Also add to blacklist
  db.run("INSERT OR IGNORE INTO blacklist (phone, reason) VALUES (?, 'unsubscribed')", [phone])
  saveDatabase()
}

export function getUnsubscribes() {
  return toRows(db.exec('SELECT * FROM unsubscribes ORDER BY timestamp DESC'))
}
