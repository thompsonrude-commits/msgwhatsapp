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
  proxy?: string | null
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
  public proxy: string | null = null  // format: "http://user:pass@host:port" or "socks5://host:port"

  constructor(accountId: string, label: string, proxy?: string) {
    super()
    this.accountId = accountId
    this.label = label
    this.proxy = proxy || null
    this.createClient()
  }

  setProxy(proxy: string | null) {
    this.proxy = proxy
  }

  private createClient() {
    const proxyArgs = this.proxy ? [`--proxy-server=${this.proxy}`] : []
    // Store auth in userData so sessions survive app updates/reinstalls
    const { app } = require('electron')
    const authDataPath = app.getPath('userData')
    this.client = new Client({
      authStrategy: new LocalAuth({
        clientId: `wab-session-${this.accountId}`,
        dataPath: authDataPath
      }),
      puppeteer: {
        headless: true,
        executablePath: getChromiumPath(),
        args: [
          '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas', '--no-first-run', '--disable-gpu',
          '--disable-extensions', '--disable-default-apps', '--mute-audio',
          '--no-default-browser-check', '--disable-features=site-per-process',
          '--disable-site-isolation-trials',
          // Anti-detection flags
          '--disable-blink-features=AutomationControlled',
          '--disable-infobars',
          '--window-size=1280,720',
          '--start-maximized',
          ...proxyArgs
        ],
        ignoreDefaultArgs: ['--enable-automation'],
      },
      webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1043880044-alpha.html'
      },
      // Rotate user agents to look like real browsers
      userAgent: this.pickUserAgent(),
      bypassCSP: true
    })

    // Inject stealth scripts after page creation
    this.client.on('loading_screen', async () => {
      try {
        const page = await (this.client as any).pupPage
        if (page) await this.applyStealthPatches(page)
      } catch (_) {}
    })

    this.setupListeners()
  }

  private pickUserAgent(): string {
    const agents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    ]
    return agents[Math.floor(Math.random() * agents.length)]
  }

  private async applyStealthPatches(page: any) {
    await page.evaluateOnNewDocument(() => {
      // Remove webdriver flag
      Object.defineProperty(navigator, 'webdriver', { get: () => false })
      // Mock plugins
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] })
      // Mock languages
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] })
      // Remove automation-related chrome properties
      delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Array
      delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Promise
      delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Symbol
      // Spoof permissions
      const originalQuery = window.navigator.permissions.query
      window.navigator.permissions.query = (parameters: any) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
          : originalQuery(parameters)
    })
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

      // Auto-reconnect unless explicitly logged out
      if (reason !== 'LOGOUT' && !String(reason).includes('replaced')) {
        const delayMs = 15000 + Math.random() * 20000 // 15-35s jitter
        console.log(`[${this.accountId}] Disconnected (${reason}), reconnecting in ${Math.round(delayMs/1000)}s...`)
        setTimeout(async () => {
          try {
            await this.client.destroy()
          } catch (_) {}
          this.createClient()
          setTimeout(() => this.initialize(), 2000)
        }, delayMs)
      }
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
    const typingDuration = Math.min(Math.max(message.length * 50, 2000), 8000)

    // Try typing indicator with a hard 5s timeout — skip silently if it hangs
    try {
      const chatResult = await Promise.race([
        this.client.getChatById(final),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
      ]) as any
      if (chatResult) {
        await chatResult.sendSeen().catch(() => {})
        await chatResult.sendStateTyping().catch(() => {})
        await new Promise(r => setTimeout(r, typingDuration))
        await chatResult.clearState().catch(() => {})
      }
    } catch (_) {
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

  // Send vCard (contact card) of self to a number
  async sendVCard(number: string, displayName: string, phone: string): Promise<void> {
    if (!this.isReady) throw new Error(`Account ${this.label} not ready`)
    const sanitized = number.replace(/\D/g, '')
    const final = sanitized.includes('@c.us') ? sanitized : `${sanitized}@c.us`
    const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${displayName}\nTEL;type=CELL;type=VOICE;waid=${phone}:+${phone}\nEND:VCARD`
    const contact = await this.client.getContactById(`${phone}@c.us`).catch(() => null)
    if (contact) {
      await this.client.sendMessage(final, contact)
    } else {
      // Fallback: send as text with vcard format
      await this.client.sendMessage(final, { body: '', vCards: [vcard] } as any)
    }
    this.dailySent++
    this.lastSentAt = new Date()
  }

  // Check if contact has a profile picture (indicates real/active account)
  async hasProfilePicture(number: string): Promise<boolean> {
    if (!this.isReady) throw new Error('Not ready')
    const sanitized = number.replace(/\D/g, '')
    const final = sanitized.includes('@c.us') ? sanitized : `${sanitized}@c.us`
    try {
      const url = await this.client.getProfilePicUrl(final)
      return !!url
    } catch { return false }
  }

  // Create a broadcast list and send to it
  async sendBroadcast(phones: string[], message: string): Promise<void> {
    if (!this.isReady) throw new Error(`Account ${this.label} not ready`)
    const contacts = phones.map(p => {
      const s = p.replace(/\D/g, '')
      return s.includes('@c.us') ? s : `${s}@c.us`
    })
    // whatsapp-web.js: send to broadcast list
    const broadcastId = contacts.join(',') + '@broadcast'
    await this.client.sendMessage(broadcastId, message)
    this.dailySent += phones.length
    this.lastSentAt = new Date()
  }

  // Get latest WhatsApp Web version from remote
  static async fetchLatestWaVersion(): Promise<string | null> {
    try {
      const fetch = (await import('node-fetch')).default as any
      const res = await fetch('https://api.github.com/repos/wppconnect-team/wa-version/contents/html', {
        headers: { 'User-Agent': 'whatsapp-bulk-app' }
      })
      const files = await res.json() as any[]
      if (!Array.isArray(files)) return null
      const htmlFiles = files
        .map((f: any) => f.name.replace('.html', ''))
        .filter((n: string) => n.match(/^2\.\d+/))
        .sort()
      return htmlFiles[htmlFiles.length - 1] || null
    } catch { return null }
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
      const authPath = path.join(app.getPath('userData'), '.wwebjs_auth', `session-wab-session-${this.accountId}`)
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
      isActive: this.isReady,
      proxy: this.proxy
    }
  }

  resetDailyCount() {
    this.dailySent = 0
  }
}

// ── Account Manager ──────────────────────────────────────────────────────────

export class WhatsAppManager extends EventEmitter {
  private accounts = new Map<string, WhatsAppAccount>()

  addAccount(accountId: string, label: string, proxy?: string): WhatsAppAccount {
    if (this.accounts.has(accountId)) return this.accounts.get(accountId)!
    const account = new WhatsAppAccount(accountId, label, proxy)
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

  setAccountProxy(accountId: string, proxy: string | null) {
    const account = this.accounts.get(accountId)
    if (!account) return
    account.setProxy(proxy)
    // Restart client with new proxy if not currently sending
    if (!account.isReady && !account.isInitializing) {
      account['createClient']()
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
