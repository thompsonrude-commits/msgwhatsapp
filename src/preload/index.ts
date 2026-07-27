import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  // ── Accounts ──────────────────────────────────────────────────────────────
  listAccounts: () => ipcRenderer.invoke('account:list'),
  getAccountStatuses: () => ipcRenderer.invoke('account:statuses'),
  addAccount: (label: string) => ipcRenderer.invoke('account:add', { label }),
  initAccount: (accountId: string) => ipcRenderer.invoke('account:init', { accountId }),
  getAccountStatus: (accountId: string) => ipcRenderer.invoke('account:status', { accountId }),
  logoutAccount: (accountId: string) => ipcRenderer.invoke('account:logout', { accountId }),
  removeAccount: (accountId: string) => ipcRenderer.invoke('account:remove', { accountId }),
  updateAccountLimit: (accountId: string, limit: number) => ipcRenderer.invoke('account:update-limit', { accountId, limit }),

  // ── WhatsApp (legacy single-account compat) ───────────────────────────────
  init: () => ipcRenderer.invoke('whatsapp:init'),
  initWhatsApp: () => ipcRenderer.invoke('whatsapp:init'),
  getStatus: () => ipcRenderer.invoke('whatsapp:status'),
  getWhatsAppStatus: () => ipcRenderer.invoke('whatsapp:status'),
  onWhatsAppEvent: (callback: (data: any) => void) => {
    const listener = (_event: any, data: any) => callback(data)
    ipcRenderer.on('whatsapp:event', listener)
    return () => ipcRenderer.removeListener('whatsapp:event', listener)
  },
  sendMessage: (data: { phone: string; message: string; accountId?: string }) =>
    ipcRenderer.invoke('whatsapp:send', data),
  sendMediaMessage: (data: { phone: string; caption: string; mediaPath: string; mimeType: string; accountId?: string }) =>
    ipcRenderer.invoke('whatsapp:send-media', data),
  isRegistered: (phone: string) => ipcRenderer.invoke('whatsapp:is-registered', phone),
  logout: () => ipcRenderer.invoke('whatsapp:logout'),
  getNextAccount: () => ipcRenderer.invoke('whatsapp:get-next-account'),

  // ── License ───────────────────────────────────────────────────────────────
  checkLicense: () => ipcRenderer.invoke('license:check'),
  activateLicense: (key: string) => ipcRenderer.invoke('license:activate', key),

  // ── Contacts ──────────────────────────────────────────────────────────────
  getContacts: () => ipcRenderer.invoke('db:get-contacts'),
  addContacts: (contacts: any[]) => ipcRenderer.invoke('db:add-contacts', contacts),
  updateContactVerification: (phone: string, isWhatsapp: boolean) =>
    ipcRenderer.invoke('db:update-contact-verification', { phone, isWhatsapp }),
  clearContacts: () => ipcRenderer.invoke('db:clear-contacts'),

  // ── Logs ──────────────────────────────────────────────────────────────────
  getLogs: (campaignId?: number) => ipcRenderer.invoke('db:get-logs', campaignId),
  getLogsForExport: (campaignId?: number) => ipcRenderer.invoke('db:get-logs-export', campaignId),
  clearLogs: () => ipcRenderer.invoke('db:clear-logs'),
  addLog: (data: { campaignId: number; campaignName: string; phone: string; status: string; error?: string; accountId?: string; name?: string; messageSent?: string }) =>
    ipcRenderer.invoke('db:add-log', data),

  // ── Campaigns ─────────────────────────────────────────────────────────────
  createCampaign: (name: string, message: string, total: number, mediaPath?: string, mediaType?: string, mediaCaption?: string, scheduledAt?: string) =>
    ipcRenderer.invoke('db:create-campaign', { name, message, total, mediaPath, mediaType, mediaCaption, scheduledAt }),
  getCampaigns: () => ipcRenderer.invoke('db:get-campaigns'),
  updateCampaign: (id: number, data: any) => ipcRenderer.invoke('db:update-campaign', { id, data }),
  deleteCampaign: (id: number) => ipcRenderer.invoke('db:delete-campaign', id),

  // ── Blacklist ─────────────────────────────────────────────────────────────
  getBlacklist: () => ipcRenderer.invoke('db:get-blacklist'),
  addToBlacklist: (phones: string[]) => ipcRenderer.invoke('db:add-blacklist', phones),
  removeFromBlacklist: (phone: string) => ipcRenderer.invoke('db:remove-blacklist', phone),
  clearBlacklist: () => ipcRenderer.invoke('db:clear-blacklist'),

  // ── Templates ─────────────────────────────────────────────────────────────
  getTemplates: () => ipcRenderer.invoke('db:get-templates'),
  saveTemplate: (name: string, message: string) => ipcRenderer.invoke('db:save-template', { name, message }),
  deleteTemplate: (id: number) => ipcRenderer.invoke('db:delete-template', id),

  // ── Unsubscribes ──────────────────────────────────────────────────────────
  getUnsubscribes: () => ipcRenderer.invoke('db:get-unsubscribes'),
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
