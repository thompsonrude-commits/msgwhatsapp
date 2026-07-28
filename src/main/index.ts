import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

import { whatsappManager, WhatsAppAccount } from './whatsapp/manager'
import * as db from './db/database'
import { checkLicense, activateKey } from './license'

let mainWindow: BrowserWindow | null = null

const isLock = app.requestSingleInstanceLock()
if (!isLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.electron')

    try {
      await db.initDatabase()
      console.log('[DB] Ready')
    } catch (e: any) {
      console.error('[DB] Failed:', e.message)
    }

    // Load saved accounts and initialize them
    const savedAccounts = db.getAccounts()
    for (const acc of savedAccounts) {
      const account = whatsappManager.addAccount(acc.id, acc.label)
      account.initialize().catch(() => {})
    }
    // If no accounts yet, create a default one
    if (savedAccounts.length === 0) {
      db.upsertAccount('default', 'Account 1')
      const account = whatsappManager.addAccount('default', 'Account 1')
      account.initialize().catch(() => {})
    }

    // Reset daily counts at midnight
    const scheduleReset = () => {
      const now = new Date()
      const msUntilMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime()
      setTimeout(() => {
        whatsappManager.resetAllDailyCounts()
        const accounts = db.getAccounts()
        accounts.forEach(a => db.resetAccountDailySent(a.id))
        scheduleReset()
      }, msUntilMidnight)
    }
    scheduleReset()

    app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

    // ── Account IPC ─────────────────────────────────────────────────────────────
    ipcMain.handle('account:list', () => db.getAccounts())
    ipcMain.handle('account:statuses', () => whatsappManager.getAllStatuses())

    ipcMain.handle('account:add', (_e, { label }) => {
      const id = `acc_${Date.now()}`
      db.upsertAccount(id, label)
      const account = whatsappManager.addAccount(id, label)
      account.initialize().catch(() => {})
      return { id, label }
    })

    ipcMain.handle('account:init', (_e, { accountId }) => {
      let account = whatsappManager.getAccount(accountId)
      if (!account) {
        const saved = db.getAccounts().find(a => a.id === accountId)
        account = whatsappManager.addAccount(accountId, saved?.label || accountId)
      }
      // If already ready, no need to reinit
      if (account.isReady) return Promise.resolve()
      // If stuck initializing, restart fresh
      if (account.isInitializing) {
        account['isInitializing'] = false
      }
      return account.initialize()
    })

    ipcMain.handle('account:status', (_e, { accountId }) => {
      const account = whatsappManager.getAccount(accountId)
      return account ? account.getStatus() : null
    })

    ipcMain.handle('account:logout', async (_e, { accountId }) => {
      const account = whatsappManager.getAccount(accountId)
      if (account) await account.logout()
    })

    ipcMain.handle('account:remove', async (_e, { accountId }) => {
      whatsappManager.removeAccount(accountId)
      db.deleteAccount(accountId)
    })

    ipcMain.handle('account:set-proxy', (_e, { accountId, proxy }) => {
      whatsappManager.setAccountProxy(accountId, proxy || null)
    })

    ipcMain.handle('account:update-limit', (_e, { accountId, limit }) => {
      db.updateAccountDailyLimit(accountId, limit)
    })

    // ── WhatsApp legacy IPC (single-account compat) ─────────────────────────────
    ipcMain.handle('whatsapp:init', () => {
      const account = whatsappManager.getAccount('default') || whatsappManager.getAllAccounts()[0]
      return account?.initialize()
    })
    ipcMain.handle('whatsapp:status', () => {
      const account = whatsappManager.getAccount('default') || whatsappManager.getAllAccounts()[0]
      return account?.getStatus() || { isReady: false, isAuthenticated: false, qrCode: null }
    })
    ipcMain.handle('whatsapp:send', async (_e, { phone, message, accountId }) => {
      const account = accountId
        ? whatsappManager.getAccount(accountId)
        : (whatsappManager.getAccount('default') || whatsappManager.getNextAccount())
      if (!account) throw new Error('No connected account')
      await account.sendMessage(phone, message)
      db.updateAccountDailySent(account.accountId, account.dailySent)
    })
    ipcMain.handle('whatsapp:send-media', async (_e, { phone, caption, mediaPath, mimeType, accountId }) => {
      const account = accountId
        ? whatsappManager.getAccount(accountId)
        : (whatsappManager.getAccount('default') || whatsappManager.getNextAccount())
      if (!account) throw new Error('No connected account')
      await account.sendMediaMessage(phone, caption, mediaPath, mimeType)
      db.updateAccountDailySent(account.accountId, account.dailySent)
    })
    ipcMain.handle('whatsapp:is-registered', async (_e, phone) => {
      const ready = whatsappManager.getReadyAccounts()
      if (ready.length === 0) throw new Error('No connected account')
      return ready[0].isRegistered(phone)
    })
    ipcMain.handle('whatsapp:logout', async () => {
      const account = whatsappManager.getAccount('default') || whatsappManager.getAllAccounts()[0]
      if (account) await account.logout()
    })

    // ── Multi-account send ───────────────────────────────────────────────────────
    ipcMain.handle('whatsapp:send-parallel', async (_e, { contacts, message: _message, minDelay: _minDelay, maxDelay: _maxDelay,
      dailyLimit: _dailyLimit, mediaPath: _mediaPath, mimeType: _mimeType, mediaCaption: _mediaCaption }) => {
      const ready = whatsappManager.getReadyAccounts()
      if (ready.length === 0) throw new Error('No connected accounts')
      // Distribute contacts evenly across ready accounts
      const chunks: typeof contacts[] = ready.map(() => [])
      contacts.forEach((c: any, i: number) => chunks[i % ready.length].push(c))
      return { accountCount: ready.length, chunks: chunks.map((ch, i) => ({ accountId: ready[i].accountId, count: ch.length })) }
    })

    ipcMain.handle('whatsapp:get-next-account', () => {
      const next = whatsappManager.getNextAccount()
      return next ? next.getStatus() : null
    })

    // ── Database IPC ─────────────────────────────────────────────────────────────
    ipcMain.handle('db:get-contacts', () => db.getContacts())
    ipcMain.handle('db:add-contacts', (_e, contacts) => db.addContacts(contacts))
    ipcMain.handle('db:update-contact-verification', (_e, { phone, isWhatsapp }) =>
      db.updateContactVerification(phone, isWhatsapp))
    ipcMain.handle('db:clear-contacts', () => db.clearContacts())
    ipcMain.handle('db:get-logs', (_e, campaignId) => db.getLogs(campaignId))
    ipcMain.handle('db:get-logs-export', (_e, campaignId) => db.getLogsForExport(campaignId))
    ipcMain.handle('db:clear-logs', () => db.clearLogs())
    ipcMain.handle('db:create-campaign', (_e, { name, message, total, mediaPath, mediaType, mediaCaption, scheduledAt }) =>
      db.createCampaign(name, message, total, mediaPath, mediaType, mediaCaption, scheduledAt))
    ipcMain.handle('db:get-campaigns', () => db.getCampaigns())
    ipcMain.handle('db:update-campaign', (_e, { id, data }) => db.updateCampaign(id, data))
    ipcMain.handle('db:delete-campaign', (_e, id) => db.deleteCampaign(id))
    ipcMain.handle('db:add-log', (_e, { campaignId, campaignName, phone, status, error, accountId, name, messageSent }) =>
      db.addLog(campaignId, campaignName, phone, status, error, accountId, name, messageSent))
    ipcMain.handle('db:get-blacklist', () => db.getBlacklist())
    ipcMain.handle('db:add-blacklist', (_e, phones) => db.addToBlacklist(phones))
    ipcMain.handle('db:remove-blacklist', (_e, phone) => db.removeFromBlacklist(phone))
    ipcMain.handle('db:clear-blacklist', () => db.clearBlacklist())
    ipcMain.handle('db:get-templates', () => db.getTemplates())
    ipcMain.handle('db:save-template', (_e, { name, message }) => db.saveTemplate(name, message))
    ipcMain.handle('db:delete-template', (_e, id) => db.deleteTemplate(id))
    ipcMain.handle('db:get-unsubscribes', () => db.getUnsubscribes())

    // ── New feature IPC ──────────────────────────────────────────────────────────
    ipcMain.handle('db:get-stats', () => db.getStats())

    ipcMain.handle('whatsapp:send-vcard', async (_e, { phone, accountId, displayName, senderPhone }) => {
      const account = accountId ? whatsappManager.getAccount(accountId) : whatsappManager.getNextAccount()
      if (!account) throw new Error('No connected account')
      await account.sendVCard(phone, displayName, senderPhone)
      db.updateAccountDailySent(account.accountId, account.dailySent)
    })

    ipcMain.handle('whatsapp:send-broadcast', async (_e, { phones, message, accountId }) => {
      const account = accountId ? whatsappManager.getAccount(accountId) : whatsappManager.getNextAccount()
      if (!account) throw new Error('No connected account')
      await account.sendBroadcast(phones, message)
      db.updateAccountDailySent(account.accountId, account.dailySent)
    })

    ipcMain.handle('whatsapp:has-profile-pic', async (_e, { phone, accountId }) => {
      const account = accountId ? whatsappManager.getAccount(accountId) : whatsappManager.getReadyAccounts()[0]
      if (!account) return false
      return account.hasProfilePicture(phone)
    })

    ipcMain.handle('whatsapp:check-version', async () => {
      const current = db.getWaVersion() || '2.3000.1043880044-alpha'
      const latest = await WhatsAppAccount.fetchLatestWaVersion()
      return { current, latest: latest || current }
    })

    ipcMain.handle('db:mark-replied', (_e, { phone }) => {
      db.markContactReplied(phone)
    })

    ipcMain.handle('account:set-warmup', (_e, { accountId, enabled }) => {
      db.updateAccountWarmup(accountId, enabled)
    })

    // ── Extended features ─────────────────────────────────────────────────────
    ipcMain.handle('db:get-warmup-limit', (_e, { accountId }) => db.getWarmupLimit(accountId))
    ipcMain.handle('db:get-followup-contacts', (_e, { hours }) => db.getFollowUpContacts(hours || 24))
    ipcMain.handle('db:auto-blacklist', (_e, { phone, threshold }) => db.autoBlacklistIfNeeded(phone, threshold || 3))
    ipcMain.handle('db:set-contact-tag', (_e, { phone, tag }) => db.setContactTag(phone, tag))
    ipcMain.handle('db:get-verified-contacts', () => db.getVerifiedContacts())
    ipcMain.handle('db:get-all-contacts-export', () => db.getAllContactsForExport())
    ipcMain.handle('db:increment-warmup-day', (_e, { accountId }) => db.incrementWarmupDay(accountId))

    // ── WA version auto-update ────────────────────────────────────────────────
    ipcMain.handle('whatsapp:update-version', async (_e, { version }) => {
      try { db.setWaVersion(version) } catch (_) {}
      return { success: true, version }
    })

    ipcMain.handle('account:update-warmup', (_e, { accountId, enabled }) => {
      db.updateAccountWarmup(accountId, enabled)
    })

    // ── License IPC ──────────────────────────────────────────────────────────────
    ipcMain.handle('license:check', () => checkLicense())
    ipcMain.handle('license:activate', (_e, key) => activateKey(key))

    mainWindow = createWindow()

    // Forward all account events to renderer
    whatsappManager.on('account:qr', (accountId, qr) =>
      mainWindow?.webContents.send('whatsapp:event', { type: 'qr', accountId, data: qr }))
    whatsappManager.on('account:authenticated', (accountId) =>
      mainWindow?.webContents.send('whatsapp:event', { type: 'authenticated', accountId }))
    whatsappManager.on('account:ready', (accountId, phone) => {
      db.updateAccountPhone(accountId, phone || '')
      mainWindow?.webContents.send('whatsapp:event', { type: 'ready', accountId, data: phone })
    })
    whatsappManager.on('account:disconnected', (accountId, reason) =>
      mainWindow?.webContents.send('whatsapp:event', { type: 'disconnected', accountId, data: reason }))
    whatsappManager.on('account:error', (accountId, err) =>
      mainWindow?.webContents.send('whatsapp:event', { type: 'error', accountId, data: err }))
    whatsappManager.on('account:unsubscribe', (accountId, phone, keyword) => {
      db.addUnsubscribe(phone, accountId, keyword)
      mainWindow?.webContents.send('whatsapp:event', { type: 'unsubscribe', accountId, data: { phone, keyword } })
    })
    whatsappManager.on('account:message', (accountId, phone, body) => {
      db.markContactReplied(phone)
      mainWindow?.webContents.send('whatsapp:event', { type: 'message', accountId, data: { phone, body } })
    })
    whatsappManager.on('account:message', (accountId, phone, body) => {
      db.markContactReplied(phone)
      mainWindow?.webContents.send('message:received', { accountId, phone, body, timestamp: Date.now() })
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
      else { mainWindow?.show(); mainWindow?.focus() }
    })
  })
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 520,
    height: 820,
    minWidth: 480,
    maxWidth: 680,
    title: 'TomWhatsBulk Sender',
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  window.on('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  window.setTitle('TomWhatsBulk Sender')
  return window
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
