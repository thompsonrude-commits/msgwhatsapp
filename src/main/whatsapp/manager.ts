import { Client, LocalAuth, MessageMedia } from 'whatsapp-web.js'
import QRCode from 'qrcode'
import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import { executablePath } from 'puppeteer'
import { app } from 'electron'

function findChromeExe(dir: string): string | null {
  if (!fs.existsSync(dir)) return null
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isFile() && entry.name.toLowerCase() === 'chrome.exe') return full
      if (entry.isDirectory()) {
        const found = findChromeExe(full)
        if (found) return found
      }
    }
  } catch (_) {}
  return null
}

function getChromiumPath(): string {
  // 1. Bundled in asar.unpacked (packaged app)
  if (app.isPackaged) {
    const base = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'puppeteer')
    const found = findChromeExe(base)
    if (found) return found
  }

  // 2. puppeteer default executablePath (works in dev)
  try {
    const defaultPath = executablePath()
    if (defaultPath && fs.existsSync(defaultPath)) return defaultPath
  } catch (_) {}

  // 3. User puppeteer cache (~/.cache/puppeteer or LOCALAPPDATA)
  const cacheDirs = [
    path.join(process.env.USERPROFILE || '', '.cache', 'puppeteer', 'chrome'),
    path.join(process.env.LOCALAPPDATA || '', 'puppeteer', 'chrome'),
    path.join(process.env.APPDATA || '', 'puppeteer', 'chrome'),
  ]
  for (const dir of cacheDirs) {
    const found = findChromeExe(dir)
    if (found) return found
  }

  // 4. System Chrome installs
  const systemPaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ]
  for (const p of systemPaths) {
    if (fs.existsSync(p)) return p
  }

  // 5. Last resort — let puppeteer figure it out
  return executablePath()
}

export interface AccountStatus {
  accountId: string
  label: string
  phone?: string
  isAuthenticated: boolean
  isReady: boolean
  qrCode: string | null
  dailySent: number
  isActive: boolean
}

export class WhatsAppAccount extends EventEmitter {
  public accountId: string
  public label: string
  private client!: Client
  private qrCode: string | null = null
  public isAuthenticated = false
  public isReady = false
  public isInitializing = false
  private initAttempts = 0
  public phone: string | undefined
  public dailySent = 0
  public lastSentAt: Date | null = null

  constructor(accountId: string, label: string) {
    super()
    this.accountId = accountId
    this.label = label
    this.createClient()
  }

  private createClient() {
    this.client = new Client({
      authStrategy: new LocalAuth({ clientId: `wab-session-${this.accountId}` }),
      puppeteer: {
        headless: true,
        executablePath: getChromiumPath(),
        args: [
          '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas', '--no-first-run', '--disable-gpu',
          '--disable-extensions', '--disable-default-apps', '--mute-audio',
          '--no-default-browser-check', '--disable-features=site-per-process',
          '--disable-site-isolation-trials'
        ],
      },
      webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1043880044-alpha.html'
      },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
      bypassCSP: true
    })
    this.setupListeners()
  }

  private setupListeners() {
    this.client.on('qr', async (qr) => {
      this.qrCode = await QRCode.toDataURL(qr)
      this.emit('qr', this.accountId, this.qrCode)
    })
    this.client.on('authenticated', () => {
      this.isAuthenticated = true
      this.qrCode = null
      this.emit('authenticated', this.accountId)
    })
    this.client.on('ready', async () => {
      this.isReady = true
      this.isInitializing = false
      try {
        const info = this.client.info
        this.phone = info?.wid?.user
      } catch (_) {}
      this.emit('ready', this.accountId, this.phone)
    })
    this.client.on('auth_failure', (msg) => {
      this.isInitializing = false
      this.emit('error', this.accountId, 'Auth failure: ' + msg)
    })
    this.client.on('disconnected', (reason) => {
      this.isReady = false
      this.isAuthenticated = false
      this.isInitializing = false
      this.emit('disconnected', this.accountId, reason)
    })
    // Auto-blacklist on STOP/unsubscribe keywords
    this.client.on('message', (msg) => {
      const body = msg.body?.toLowerCase().trim()
      const stopWords = ['stop', 'unsubscribe', 'remove me', 'opt out', 'no more', 'cancel']
      if (stopWords.some(w => body === w || body?.startsWith(w))) {
        const phone = msg.from.replace('@c.us', '')
        this.emit('unsubscribe', this.accountId, phone, msg.body)
      }
    })
  }

  async initialize() {
    if (this.isReady || this.isAuthenticated || this.isInitializing) return
    this.isInitializing = true
    try {
      await this.client.initialize()
      this.initAttempts = 0
    } catch (err: any) {
      this.isInitializing = false
      const msg = err.message || ''

      // Kill orphaned Chrome process holding the session lock then retry
      if (msg.includes('browser is already running') || msg.includes('userDataDir')) {
        try {
          const { execSync } = await import('child_process')
          execSync('taskkill /F /IM chrome.exe /T 2>nul', { stdio: 'ignore' })
          execSync('taskkill /F /IM WhatsAppBulkSender.exe /FI "PID ne ' + process.pid + '" /T 2>nul', { stdio: 'ignore' })
        } catch (_) {}
        // Also delete the SingletonLock file that Chrome leaves behind
        try {
          const fs = await import('fs')
          const path = await import('path')
          const { app } = await import('electron')
          const lockFile = path.join(app.getPath('userData'), '.wwebjs_auth', `session-wab-session-${this.accountId}`, 'SingletonLock')
          if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile)
          const lockSocket = path.join(app.getPath('userData'), '.wwebjs_auth', `session-wab-session-${this.accountId}`, 'SingletonSocket')
          if (fs.existsSync(lockSocket)) fs.unlinkSync(lockSocket)
          const lockCookie = path.join(app.getPath('userData'), '.wwebjs_auth', `session-wab-session-${this.accountId}`, 'SingletonCookie')
          if (fs.existsSync(lockCookie)) fs.unlinkSync(lockCookie)
        } catch (_) {}
        this.createClient()
        setTimeout(() => this.initialize(), 2000)
        return
      }

      if ((msg.includes('Navigating frame was detached') || msg.includes('Execution context was destroyed')) && this.initAttempts < 3) {
        this.initAttempts++
        try { await this.client.destroy() } catch (_) {}
        this.createClient()
        setTimeout(() => this.initialize(), 3000)
        return
      }
      this.initAttempts = 0
      this.emit('error', this.accountId, 'Init error: ' + msg)
    }
  }

  async isRegistered(number: string): Promise<boolean> {
    if (!this.isReady) throw new Error('Not ready')
    const sanitized = number.replace(/\D/g, '')
    const final = sanitized.includes('@c.us') ? sanitized : `${sanitized}@c.us`
    return await this.client.isRegisteredUser(final)
  }

  async sendMessage(number: string, message: string): Promise<void> {
    if (!this.isReady) throw new Error(`Account ${this.label} not ready`)
    const sanitized = number.replace(/\D/g, '')
    const final = sanitized.includes('@c.us') ? sanitized : `${sanitized}@c.us`
    // Use direct sendMessage — getChatById is unreliable on newer WA Web versions
    const typingDuration = Math.min(Math.max(message.length * 50, 2000), 8000)
    try {
      const chat = await this.client.getChatById(final)
      await chat.sendSeen()
      await chat.sendStateTyping()
      await new Promise(r => setTimeout(r, typingDuration))
      await chat.clearState()
    } catch (_) {
      // Fallback: just wait the typing duration if chat fetch fails
      await new Promise(r => setTimeout(r, typingDuration))
    }
    await new Promise(r => setTimeout(r, 500 + Math.random() * 1000))
    await this.client.sendMessage(final, message)
    this.dailySent++
    this.lastSentAt = new Date()
  }

  async sendMediaMessage(number: string, caption: string, mediaPath: string, mimeType: string): Promise<void> {
    if (!this.isReady) throw new Error(`Account ${this.label} not ready`)
    const sanitized = number.replace(/\D/g, '')
    const final = sanitized.includes('@c.us') ? sanitized : `${sanitized}@c.us`
    const data = fs.readFileSync(mediaPath).toString('base64')
    const filename = path.basename(mediaPath)
    const media = new MessageMedia(mimeType, data, filename)
    await this.client.sendMessage(final, media, { caption })
    this.dailySent++
    this.lastSentAt = new Date()
  }

  async logout() {
    try { await this.client.destroy() } catch (_) {}
    this.isReady = false
    this.isAuthenticated = false
    this.isInitializing = false
    this.qrCode = null
    // Clean up lock files left by Chrome
    try {
      const fs = await import('fs')
      const path = await import('path')
      const { app } = await import('electron')
      const sessionDir = path.join(app.getPath('userData'), '.wwebjs_auth', `session-wab-session-${this.accountId}`)
      for (const lock of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
        const f = path.join(sessionDir, lock)
        if (fs.existsSync(f)) fs.unlinkSync(f)
      }
    } catch (_) {}
    try {
      const authPath = path.join(process.cwd(), '.wwebjs_auth', `session-wab-session-${this.accountId}`)
      if (fs.existsSync(authPath)) fs.rmSync(authPath, { recursive: true, force: true })
    } catch (_) {}
    this.createClient()
    this.emit('disconnected', this.accountId, 'logout')
  }

  getStatus(): AccountStatus {
    return {
      accountId: this.accountId,
      label: this.label,
      phone: this.phone,
      isAuthenticated: this.isAuthenticated,
      isReady: this.isReady,
      qrCode: this.qrCode,
      dailySent: this.dailySent,
      isActive: this.isReady
    }
  }

  resetDailyCount() {
    this.dailySent = 0
  }
}

// ── Account Manager ──────────────────────────────────────────────────────────

export class WhatsAppManager extends EventEmitter {
  private accounts = new Map<string, WhatsAppAccount>()

  addAccount(accountId: string, label: string): WhatsAppAccount {
    if (this.accounts.has(accountId)) return this.accounts.get(accountId)!
    const account = new WhatsAppAccount(accountId, label)
    this.wireEvents(account)
    this.accounts.set(accountId, account)
    return account
  }

  private wireEvents(account: WhatsAppAccount) {
    account.on('qr', (id, qr) => this.emit('account:qr', id, qr))
    account.on('authenticated', (id) => this.emit('account:authenticated', id))
    account.on('ready', (id, phone) => this.emit('account:ready', id, phone))
    account.on('disconnected', (id, reason) => this.emit('account:disconnected', id, reason))
    account.on('error', (id, err) => this.emit('account:error', id, err))
    account.on('unsubscribe', (id, phone, keyword) => this.emit('account:unsubscribe', id, phone, keyword))
  }

  removeAccount(accountId: string) {
    const account = this.accounts.get(accountId)
    if (account) {
      account.logout().catch(() => {})
      this.accounts.delete(accountId)
    }
  }

  getAccount(accountId: string): WhatsAppAccount | undefined {
    return this.accounts.get(accountId)
  }

  getAllAccounts(): WhatsAppAccount[] {
    return Array.from(this.accounts.values())
  }

  getAllStatuses(): AccountStatus[] {
    return this.getAllAccounts().map(a => a.getStatus())
  }

  getReadyAccounts(): WhatsAppAccount[] {
    return this.getAllAccounts().filter(a => a.isReady)
  }

  // Pick the ready account with lowest dailySent (smart rotation)
  getNextAccount(): WhatsAppAccount | null {
    const ready = this.getReadyAccounts()
    if (ready.length === 0) return null
    return ready.sort((a, b) => a.dailySent - b.dailySent)[0]
  }

  async initializeAll() {
    for (const account of this.getAllAccounts()) {
      account.initialize().catch(() => {})
    }
  }

  resetAllDailyCounts() {
    for (const account of this.getAllAccounts()) {
      account.resetDailyCount()
    }
  }
}

export const whatsappManager = new WhatsAppManager()
