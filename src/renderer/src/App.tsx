import { useState, useEffect, useRef } from 'react'
import { 
  MessageCircle, 
  History,
  LayoutDashboard,
  Settings,
  X,
  Plus,
  ShieldCheck,
  UserPlus,
  CheckCheck,
  AlertCircle,
  LogOut,
  Smartphone,
  RefreshCw
} from 'lucide-react'
import { twistMessage } from './utils/twister'

const AppLogo = () => (
  <div className="flex items-center gap-1">
    <div className="w-4 h-4 bg-[#25D366] rounded flex items-center justify-center">
      <MessageCircle className="w-3 h-3 text-white fill-current" />
    </div>
    <span className="text-[10px] font-black text-[#128C7E] tracking-tighter uppercase leading-none">TOM<span className="text-[#25D366]">WHATS</span></span>
  </div>
)

function App() {
  // 1. State
  const [activeTab, setActiveTab] = useState('campaign')
  const [status, setStatus] = useState<any>({ isReady: false, isAuthenticated: false, qrCode: null })
  // Multi-account state
  const [accounts, setAccounts] = useState<any[]>([])
  const [accountStatuses, setAccountStatuses] = useState<Record<string, any>>({})
  const [newAccountLabel, setNewAccountLabel] = useState('')
  const [addingAccount, setAddingAccount] = useState(false)
  const [contacts, setContacts] = useState<any[]>([])
  const [extractionResults, setExtractionResults] = useState<any[]>([])
  const [logs, setLogs] = useState<any[]>([])
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [messageTemplate, setMessageTemplate] = useState('')
  const [isSmartTwistEnabled, setIsSmartTwistEnabled] = useState(true)
  const [countryCode, setCountryCode] = useState('234')
  const [startNumber, setStartNumber] = useState('')
  const [quantity, setQuantity] = useState(100)
  const [isVerifying, setIsVerifying] = useState(false)
  const isVerifyingRef = useRef(false)
  const [isSending, setIsSending] = useState(false)
  const isSendingRef = useRef(false)
  const logEndRef = useRef<HTMLDivElement>(null)
  const [contactStatuses, setContactStatuses] = useState<Record<string, 'pending' | 'sending' | 'sent' | 'failed'>>({})
  const [license, setLicense] = useState<{ valid: boolean; trialExpired: boolean; hoursLeft: number; machineId: string } | null>(null)
  const [licenseKey, setLicenseKey] = useState('')
  const [licenseError, setLicenseError] = useState('')
  const [verifyOnImport, setVerifyOnImport] = useState(false)
  const [isImportVerifying, setIsImportVerifying] = useState(false)
  const isImportVerifyingRef = useRef(false)
  const [importProgress, setImportProgress] = useState<{ current: number; total: number; valid: number } | null>(null)
  // 2. Helpers (Defined BEFORE useEffect to avoid hoisting issues)
  const loadData = async () => {
    const api = (window as any).api;
    if (!api) return;
    try {
      const c = await api.getContacts()
      const l = await api.getLogs()
      setContacts(c || [])
      setLogs(l || [])
      const lic = await api.checkLicense()
      setLicense(lic)
    } catch (e) { console.error('Data Load Fail') }
  }

  const loadAccounts = async () => {
    const api = (window as any).api;
    if (!api) return;
    try {
      const [accs, statuses] = await Promise.all([api.listAccounts(), api.getAccountStatuses()])
      setAccounts(accs || [])
      // Build a map of accountId -> status
      const statusMap: Record<string, any> = {}
      for (const s of (statuses || [])) statusMap[s.accountId] = s
      setAccountStatuses(statusMap)
      // Update legacy single-status for backwards compat
      const anyReady = (statuses || []).find((s: any) => s.isReady)
      if (anyReady) setStatus({ isReady: true, isAuthenticated: true, qrCode: null, phone: anyReady.phone })
    } catch (_) {}
  }

  const readyAccounts = () => Object.values(accountStatuses).filter((s: any) => s.isReady)
  const isAnyReady = () => readyAccounts().length > 0


  // 3. Effects
  useEffect(() => {
    const api = (window as any).api

    if (api) api.checkLicense().then(setLicense)

    loadData()
    loadAccounts()
    const timer = setInterval(loadAccounts, 3000)

    const licTimer = setInterval(async () => {
      if (api) { const lic = await api.checkLicense(); setLicense(lic) }
    }, 60000)

    // Per-account real-time events
    let cleanup = () => {}
    if (api && typeof api.onWhatsAppEvent === 'function') {
      cleanup = api.onWhatsAppEvent((event: any) => {
        const { type, accountId, data } = event
        if (type === 'qr') {
          setAccountStatuses(prev => ({ ...prev, [accountId]: { ...prev[accountId], accountId, qrCode: data } }))
        } else if (type === 'authenticated' || type === 'ready') {
          setAccountStatuses(prev => ({ ...prev, [accountId]: { ...prev[accountId], accountId, isAuthenticated: true, isReady: true, qrCode: null, phone: data || prev[accountId]?.phone } }))
          setStatus((prev: any) => ({ ...prev, isReady: true, isAuthenticated: true, qrCode: null }))
          setIsConnectModalOpen(false)
        } else if (type === 'disconnected') {
          setAccountStatuses(prev => ({ ...prev, [accountId]: { ...prev[accountId], accountId, isReady: false, isAuthenticated: false, qrCode: null } }))
        } else if (type === 'error') {
          setError(`WhatsApp Error: ${data}`)
        } else if (type === 'unsubscribe') {
          setSuccess(`Auto-unsubscribed: +${data?.phone || data}`)
        }
      })
    }

    return () => { clearInterval(timer); clearInterval(licTimer); cleanup() }
  }, [])

  useEffect(() => {
    if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // 4. Handlers
  // 4. Handlers
  const handleConnectAccount = async (accountId: string) => {
    const api = (window as any).api; if (!api) return
    await api.initAccount(accountId)
  }

  const handleDisconnectAccount = async (accountId: string) => {
    const api = (window as any).api; if (!api) return
    await api.logoutAccount(accountId)
    await loadAccounts()
  }

  const handleAddAccount = async () => {
    const api = (window as any).api; if (!api) return
    const label = newAccountLabel.trim() || `Account ${accounts.length + 1}`
    setAddingAccount(true)
    await api.addAccount(label)
    setNewAccountLabel('')
    setAddingAccount(false)
    await loadAccounts()
  }

  const handleRemoveAccount = async (accountId: string) => {
    const api = (window as any).api; if (!api) return
    await api.removeAccount(accountId)
    await loadAccounts()
  }


  const handleGenerateNumbers = async () => {
    const api = (window as any).api;
    if (!api) return;
    setIsVerifying(true)
    isVerifyingRef.current = true
    setError(null)
    setExtractionResults([])
    const base = parseInt(startNumber)
    if (!base) { setError("Set Start Num"); setIsVerifying(false); isVerifyingRef.current = false; return; }

    for (let i = 0; i < quantity; i++) {
       if (!isVerifyingRef.current) break
       const num = (base + i).toString()
       const fullNum = `${countryCode}${num}`
       try {
         const isReg = await api.isRegistered(fullNum)
         if (isReg) {
           const lead = { phone: fullNum, name: `Lead ${i+1}` }
           setExtractionResults(prev => [lead, ...prev])
           await api.addContacts([lead])
         }
       } catch (e: any) { console.error(e) }
       await new Promise(r => setTimeout(r, 1000))
    }
    setIsVerifying(false)
    isVerifyingRef.current = false
    await loadData()
  }

  const handleStopVerification = () => {
    setIsVerifying(false)
    isVerifyingRef.current = false
  }

  const handleExportLeads = () => {
    if (extractionResults.length === 0) {
      setError("No leads to export");
      return;
    }
    const csvContent = "data:text/csv;charset=utf-8,Phone,Name\n" 
      + extractionResults.map(e => `${e.phone},${e.name}`).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "whatsapp_active_leads.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  const handleTransferToCampaign = async () => {
    const api = (window as any).api;
    if (!api || extractionResults.length === 0) return;
    try {
      await api.addContacts(extractionResults);
      await loadData();
      setSuccess("Leads Transferred to Campaign!");
      setError(null);
    } catch(e) { console.error(e) }
  }

  const handleStopImportVerification = () => {
    setIsImportVerifying(false)
    isImportVerifyingRef.current = false
  }

  const handleImportContacts = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const text = evt.target?.result as string;
      if (!text) return;
      
      const lines = text.split('\n');
      const api = (window as any).api;
      if (!api) return;
      
      const parsed: any[] = [];
      lines.forEach((line, i) => {
        const parts = line.split(',');
        let phone = parts[0]?.trim() || '';
        phone = phone.replace(/\D/g, ''); // Extract only digits
        
        if (phone.length > 5) {
          parsed.push({ phone, name: parts[1]?.trim() || `Imported ${i+1}` });
        }
      });
      
      if (parsed.length === 0) {
        setError('No valid numbers found in file.');
        return;
      }

      // If verify mode is on and WhatsApp is connected, check each number
      if (verifyOnImport && status.isReady) {
        setIsImportVerifying(true)
        isImportVerifyingRef.current = true
        setImportProgress({ current: 0, total: parsed.length, valid: 0 })
        setError(null)

        const verified: any[] = []
        for (let i = 0; i < parsed.length; i++) {
          if (!isImportVerifyingRef.current) break
          try {
            const isReg = await api.isRegistered(parsed[i].phone)
            if (isReg) verified.push(parsed[i])
          } catch (err) {
            console.error('[Import Verify]', err)
          }
          // Update progress after each check so valid count is accurate
          setImportProgress({ current: i + 1, total: parsed.length, valid: verified.length })
          // Small delay to avoid hammering WhatsApp
          await new Promise(r => setTimeout(r, 800))
        }

        setIsImportVerifying(false)
        isImportVerifyingRef.current = false
        setImportProgress(null)

        if (verified.length > 0) {
          await api.addContacts(verified)
          await loadData()
          setSuccess(`Verified & imported ${verified.length} of ${parsed.length} numbers active on WhatsApp.`)
          setError(null)
        } else {
          setError('No numbers from the file are active on WhatsApp.')
        }
      } else {
        // No verification — import all parsed numbers directly
        if (verifyOnImport && !status.isReady) {
          setError('Connect WhatsApp first to verify numbers, or disable verify mode.')
          return
        }
        await api.addContacts(parsed);
        await loadData();
        setSuccess(`Imported ${parsed.length} numbers successfully!`);
        setError(null);
      }
    };
    reader.readAsText(file);
    // Reset file input
    e.target.value = '';
  }


  const [quickPhone, setQuickPhone] = useState('')
  const [isSendingQuick, setIsSendingQuick] = useState(false)
  const [speedPreset, setSpeedPreset] = useState('normal')
  const [minDelay, setMinDelay] = useState(45)
  const [maxDelay, setMaxDelay] = useState(120)
  const [dailyLimit, setDailyLimit] = useState(300)
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [scheduleStart, setScheduleStart] = useState('09:00')
  const [scheduleEnd, setScheduleEnd] = useState('17:00')
  const [breakEnabled, setBreakEnabled] = useState(true)
  const [breakEvery, setBreakEvery] = useState(25)
  const [breakDuration, setBreakDuration] = useState(10)
  const [shuffleContacts, setShuffleContacts] = useState(false)

  const applyPreset = (preset: string) => {
    setSpeedPreset(preset)
    if (preset === 'safe') { setMinDelay(90); setMaxDelay(180) }
    else if (preset === 'normal') { setMinDelay(45); setMaxDelay(120) }
    else { setMinDelay(20); setMaxDelay(45) }
  }
  const [simState, setSimState] = useState<'idle' | 'typing' | 'sending' | 'sent'>('idle')
  const [simTypedText, setSimTypedText] = useState('')
  const [simPhone, setSimPhone] = useState('')

  const handleQuickSend = async () => {
    const api = (window as any).api
    if (!api || !isAnyReady()) { setError('Connect WhatsApp first'); return }
    if (!quickPhone.trim()) { setError('Enter a phone number'); return }
    if (!messageTemplate.trim()) { setError('Type a message first'); return }
    setIsSendingQuick(true)
    setSimPhone(quickPhone.replace(/\D/g, ''))
    try {
      let finalMessage = messageTemplate.replace('{name}', '')
      if (isSmartTwistEnabled) finalMessage = twistMessage(finalMessage, 0.3)

      // Simulate typing character by character
      setSimState('typing')
      setSimTypedText('')
      const typingDelay = Math.min(Math.max(finalMessage.length * 40, 1500), 6000)
      const charInterval = typingDelay / finalMessage.length
      for (let i = 0; i <= finalMessage.length; i++) {
        await new Promise(r => setTimeout(r, charInterval))
        setSimTypedText(finalMessage.slice(0, i))
      }

      // Simulate clicking send
      setSimState('sending')
      await new Promise(r => setTimeout(r, 600 + Math.random() * 400))

      await api.sendMessage({ phone: quickPhone.replace(/\D/g, ''), message: finalMessage })
      setSimState('sent')
      setSuccess(`Sent to ${quickPhone}`)
      setQuickPhone('')
      await loadData()
      await new Promise(r => setTimeout(r, 2000))
    } catch (e: any) {
      setError(`Failed: ${e.message}`)
    }
    setSimState('idle')
    setSimTypedText('')
    setIsSendingQuick(false)
  }

  const handleActivateLicense = async () => {
    const api = (window as any).api
    if (!licenseKey.trim()) { setLicenseError('Enter your serial key'); return }
    const result = await api.activateLicense(licenseKey)
    if (result.success) {
      const lic = await api.checkLicense()
      setLicense(lic)
      setLicenseError('')
    } else {
      setLicenseError(result.error || 'Activation failed.')
    }
  }

  const handleStopSending = () => {
    setIsSending(false)
    isSendingRef.current = false
  }

  const handleStartCampaign = async () => {
    const api = (window as any).api;
    const ready = readyAccounts()
    if (!api || ready.length === 0) { setError('Connect at least one WhatsApp account'); return; }
    if (contacts.length === 0) { setError('No leads'); return; }
    setIsSending(true)
    isSendingRef.current = true

    const initial: Record<string, 'pending' | 'sending' | 'sent' | 'failed'> = {}
    contacts.forEach(c => { initial[c.phone] = 'pending' })
    setContactStatuses(initial)

    let accountIndex = 0 // round-robin index

    for (const contact of contacts) {
      if (!isSendingRef.current) break;
      setContactStatuses(prev => ({ ...prev, [contact.phone]: 'sending' }))
      try {
        let finalMessage = messageTemplate.replace('{name}', contact.name || '')
        if (isSmartTwistEnabled) finalMessage = twistMessage(finalMessage, 0.3)

        // Pick next ready account (round-robin)
        const currentReady = readyAccounts()
        if (currentReady.length === 0) { setError('All accounts disconnected'); break }
        const targetAccount = currentReady[accountIndex % currentReady.length]
        accountIndex++

        setSimPhone(`${contact.phone} [${targetAccount.label || targetAccount.accountId}]`)
        setSimState('typing')
        setSimTypedText('')
        const tMs = Math.min(Math.max(finalMessage.length * 40, 1500), 6000)
        const cMs = tMs / finalMessage.length
        for (let ci = 0; ci <= finalMessage.length; ci++) {
          if (!isSendingRef.current) break
          await new Promise(r => setTimeout(r, cMs))
          setSimTypedText(finalMessage.slice(0, ci))
        }
        setSimState('sending')
        await new Promise(r => setTimeout(r, 600))

        await api.sendMessage({ phone: contact.phone, message: finalMessage, accountId: targetAccount.accountId })
        setSimState('sent')
        await new Promise(r => setTimeout(r, 1500))
        setSimState('idle')
        setSimTypedText('')
        setContactStatuses(prev => ({ ...prev, [contact.phone]: 'sent' }))
        await loadData()
      } catch (e: any) {
        console.error(e)
        setContactStatuses(prev => ({ ...prev, [contact.phone]: 'failed' }))
        setError(`Failed to send to ${contact.phone}: ${e?.message || 'Unknown error'}`)
        await new Promise(r => setTimeout(r, 3000))
        setError(null)
      }
      const delayMs = (minDelay + Math.random() * (maxDelay - minDelay)) * 1000
      await new Promise(r => setTimeout(r, delayMs))
    }
    setIsSending(false)
    isSendingRef.current = false
  }

  return (
    <div className="flex flex-col h-screen bg-[#F0F2F5] text-[#3b4a54] font-sans selection:bg-[#25D366]/30 text-[9px] overflow-hidden">
      
      {/* Header */}
      <header className="bg-[#00A884] shrink-0 z-30 shadow-sm">
        <div className="h-9 flex items-center px-2 justify-between">
          <div className="bg-white px-1 py-0.5 rounded shadow-sm"><AppLogo /></div>
          <div className="flex items-center gap-1.5">
            {readyAccounts().length > 0 ? (
              <div className="px-1.5 py-0.5 rounded-full flex items-center gap-1 bg-white/20 text-white font-black text-[7px] uppercase">
                <div className="w-1 h-1 rounded-full bg-[#25D366]" />
                {readyAccounts().length} LIVE
              </div>
            ) : (
              <>
                <div className="px-1.5 py-0.5 rounded-full flex items-center gap-1 bg-white/20 text-white font-black text-[7px] uppercase">
                  <div className="w-1 h-1 rounded-full bg-white" />OFF
                </div>
                <button onClick={() => setActiveTab('accounts')} className="bg-white text-[#00A884] px-2 py-0.5 rounded font-black text-[8px] active:scale-95 transition-all shadow-sm">LINK</button>
              </>
            )}
          </div>
        </div>
        {license && !license.trialExpired && license.hoursLeft > 0 && (
          <div className="bg-yellow-400 text-black px-2 py-0.5 flex items-center justify-between text-[7px] font-black">
            <span>⏳ TRIAL: {Math.floor(license.hoursLeft)}h {Math.floor((license.hoursLeft % 1) * 60)}m remaining</span>
            <span className="opacity-60 uppercase tracking-wider">Enter serial key to unlock</span>
          </div>
        )}
      </header>

      <div className="flex-1 flex overflow-hidden">
        
        {/* Sidebar */}
        <aside className="w-8 bg-white border-r flex flex-col items-center py-2 gap-3 shrink-0 z-20">
          <button onClick={() => setActiveTab('campaign')} className={`p-1 rounded ${activeTab === 'campaign' ? 'text-[#00A884] bg-[#F0F2F5]' : 'text-gray-300'}`}><LayoutDashboard className="w-4 h-4" /></button>
          <button onClick={() => setActiveTab('accounts')} title="Accounts" className={`p-1 rounded relative ${activeTab === 'accounts' ? 'text-[#00A884] bg-[#F0F2F5]' : 'text-gray-300'}`}>
            <Smartphone className="w-4 h-4" />
            {readyAccounts().length > 0 && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-[#25D366] rounded-full border border-white" />}
          </button>
          <button onClick={() => setActiveTab('generator')} className={`p-1 rounded ${activeTab === 'generator' ? 'text-[#00A884] bg-[#F0F2F5]' : 'text-gray-300'}`}><UserPlus className="w-4 h-4" /></button>
          <button onClick={() => setActiveTab('history')} className={`p-1 rounded ${activeTab === 'history' ? 'text-[#00A884] bg-[#F0F2F5]' : 'text-gray-300'}`}><History className="w-4 h-4" /></button>
          <div className="mt-auto flex flex-col items-center gap-3 w-full">
            <button onClick={() => setActiveTab('settings')} className={`p-1 rounded ${activeTab === 'settings' ? 'text-[#00A884] bg-[#F0F2F5]' : 'text-gray-300 hover:text-gray-500'}`}><Settings className="w-4 h-4" /></button>
            <button className="p-1 text-red-300 hover:text-red-500" onClick={async () => {
              await (window as any).api?.logout()
              setStatus({ isReady: false, isAuthenticated: false, qrCode: null })
            }}><LogOut className="w-4 h-4" /></button>
          </div>
        </aside>

        {/* Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          
          <div className="flex-1 flex overflow-hidden p-1.5 gap-1.5">
             
             {/* Dynamic Main View based on activeTab */}
             {activeTab === 'campaign' && (
               <section className="flex-1 flex flex-col gap-1.5 min-w-0 overflow-hidden">
                  {/* Message Editor */}
                  <div className="bg-white rounded border p-1.5 flex flex-col shadow-sm" style={{height: '45%'}}>
                     <div className="flex justify-between items-center mb-1">
                        <span className="font-black text-gray-300 text-[10px] uppercase">EDITOR</span>
                        <ShieldCheck className="w-3 h-3 text-[#00A884]" />
                     </div>
                     <div className="relative flex-1">
                        <textarea 
                          value={messageTemplate}
                          onChange={(e) => setMessageTemplate(e.target.value)}
                          placeholder="Type message..."
                          className="w-full h-full p-2 bg-[#F8F9FA] border rounded outline-none text-[10px] font-bold resize-none"
                        />
                        <div className="absolute bottom-1 right-1 flex items-center gap-1 bg-white border p-0.5 rounded scale-75 origin-bottom-right">
                           <span className="text-[7px] font-black text-gray-400 uppercase">Twist</span>
                           <button onClick={() => setIsSmartTwistEnabled(!isSmartTwistEnabled)} className={`w-5 h-2.5 rounded-full relative ${isSmartTwistEnabled ? 'bg-[#00A884]' : 'bg-gray-300'}`}>
                              <div className={`absolute top-0.5 w-1.5 h-1.5 bg-white rounded-full transition-transform ${isSmartTwistEnabled ? 'left-3' : 'left-0.5'}`} />
                           </button>
                        </div>
                     </div>
                     <div className="mt-1.5 flex items-center gap-1 shrink-0">
                        <input
                          value={quickPhone}
                          onChange={e => setQuickPhone(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleQuickSend()}
                          placeholder="Quick send: +2348..."
                          className="flex-1 p-1 border rounded text-[9px] font-bold outline-none focus:border-[#00A884] bg-[#F8F9FA]"
                        />
                        <button
                          onClick={handleQuickSend}
                          disabled={!status.isReady || isSendingQuick}
                          className="px-2 py-1 bg-[#128C7E] text-white rounded font-black text-[8px] uppercase disabled:opacity-40 active:scale-95 transition-all shrink-0"
                        >
                          {isSendingQuick ? '...' : 'SEND'}
                        </button>
                     </div>
                     {/* Delay controls */}
                     <div className="flex items-center gap-1.5 mt-1 shrink-0">
                       <span className="text-[7px] font-black text-gray-400 uppercase tracking-wider">Delay:</span>
                       <input
                         type="number"
                         value={minDelay}
                         onChange={e => setMinDelay(Math.max(5, Number(e.target.value)))}
                         disabled={isSending}
                         className="w-10 border rounded px-1 py-0.5 text-[8px] font-bold text-center outline-none focus:border-[#00A884] disabled:opacity-40"
                         title="Min delay (seconds)"
                       />
                       <span className="text-[7px] text-gray-300">–</span>
                       <input
                         type="number"
                         value={maxDelay}
                         onChange={e => setMaxDelay(Math.max(minDelay + 1, Number(e.target.value)))}
                         disabled={isSending}
                         className="w-10 border rounded px-1 py-0.5 text-[8px] font-bold text-center outline-none focus:border-[#00A884] disabled:opacity-40"
                         title="Max delay (seconds)"
                       />
                       <span className="text-[7px] text-gray-400">sec</span>
                       <div className="flex gap-0.5 ml-auto">
                         {[['Safe','90','180'],['Normal','45','120'],['Fast','20','45']].map(([label, mn, mx]) => (
                           <button key={label} onClick={() => { setMinDelay(Number(mn)); setMaxDelay(Number(mx)) }}
                             disabled={isSending}
                             className={`px-1 py-0.5 rounded text-[6px] font-black uppercase tracking-wider transition-colors disabled:opacity-40 ${minDelay === Number(mn) && maxDelay === Number(mx) ? 'bg-[#00A884] text-white' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}>
                             {label}
                           </button>
                         ))}
                       </div>
                     </div>
                     <div className="mt-1 flex items-center justify-between shrink-0">
                        <div className="flex items-center gap-1.5 bg-gray-50 border rounded px-1.5 py-0.5 shadow-sm">
                           <label className={`cursor-pointer flex items-center gap-1 text-[8px] font-black uppercase tracking-wider transition-colors ${isImportVerifying ? 'text-gray-300 pointer-events-none' : 'text-[#00A884] hover:text-[#009272]'}`}>
                              <Plus className="w-2.5 h-2.5" /> IMPORT
                              <input type="file" accept=".csv,.txt" className="hidden" onChange={handleImportContacts} disabled={isImportVerifying} />
                           </label>
                           <div className="w-px h-3 bg-gray-200 mx-0.5" />
                           {/* Verify toggle */}
                           <button
                             onClick={() => setVerifyOnImport(v => !v)}
                             title={verifyOnImport ? 'Verify mode ON — only active WhatsApp numbers will be imported' : 'Verify mode OFF — all numbers imported without checking'}
                             className={`flex items-center gap-0.5 text-[7px] font-black uppercase tracking-wider transition-colors rounded px-0.5 py-0.5 ${verifyOnImport ? 'text-white bg-[#00A884]' : 'text-gray-400 bg-gray-100 hover:bg-gray-200'}`}
                           >
                             <ShieldCheck className="w-2.5 h-2.5" />
                             <span>VERIFY {verifyOnImport ? 'ON' : 'OFF'}</span>
                           </button>
                           <div className="w-px h-3 bg-gray-200 mx-0.5" />
                           <span className="text-[7px] font-black text-gray-400">QUEUED: {contacts.length}</span>
                        </div>
                        <button 
                          onClick={isSending ? handleStopSending : handleStartCampaign}
                          disabled={!isAnyReady()}
                          className={`px-4 py-1 rounded font-black text-[10px] uppercase tracking-tighter shadow ${isSending ? 'bg-red-500 text-white' : 'bg-[#00A884] text-white active:scale-95'}`}
                        >
                           {isSending ? 'STOP' : 'SEND'}
                        </button>
                     </div>
                     {/* Import verification progress bar */}
                     {isImportVerifying && importProgress && (
                       <div className="mt-1 shrink-0">
                         <div className="flex items-center justify-between mb-0.5">
                           <span className="text-[7px] font-black text-[#00A884] uppercase flex items-center gap-1">
                             <ShieldCheck className="w-2 h-2" />
                             Checking {importProgress.current}/{importProgress.total} — <span className="text-[#25D366]">{importProgress.valid} active</span>
                           </span>
                           <button onClick={handleStopImportVerification} className="text-[7px] font-black text-red-400 uppercase hover:text-red-600">STOP</button>
                         </div>
                         <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                           <div
                             className="h-full bg-[#00A884] rounded-full transition-all duration-300"
                             style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                           />
                         </div>
                       </div>
                     )}
                  </div>

                  {/* Typing Simulation Preview */}
                  {simState !== "idle" && (
                    <div className="bg-white rounded border shadow-sm shrink-0 overflow-hidden mb-1.5">
                      <div className="px-1.5 py-0.5 bg-[#075E54] border-b flex items-center justify-between">
                        <span className="text-[7px] font-black text-white uppercase tracking-widest">WHATSAPP PREVIEW</span>
                        <span className="text-[7px] font-black text-[#25D366]">+{simPhone}</span>
                      </div>
                      <div className="p-2 bg-[#ECE5DD]">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1 text-[7px] text-gray-500 font-black uppercase mb-1">
                            {simState === "typing" && <><span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse inline-block" /><span>Typing message...</span></>}
                            {simState === "sending" && <><span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse inline-block" /><span>Clicking send button...</span></>}
                            {simState === "sent" && <><span className="w-1.5 h-1.5 rounded-full bg-[#25D366] inline-block" /><span>Message delivered!</span></>}
                          </div>
                          <div className="bg-[#DCF8C6] rounded-lg rounded-br-none px-2 py-1.5 max-w-[85%] self-end shadow-sm relative">
                            <p className="text-[9px] text-gray-800 font-medium whitespace-pre-wrap break-words min-h-[12px]">
                              {simTypedText}{simState === "typing" && <span className="inline-block w-0.5 h-3 bg-gray-700 animate-pulse ml-0.5 align-middle" />}
                            </p>
                            <div className="flex items-center justify-end gap-0.5 mt-0.5">
                              <span className="text-[6px] text-gray-400">{new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span>
                              {simState === "sent" && <CheckCheck className="w-2.5 h-2.5 text-[#34B7F1]" />}
                              {simState === "sending" && <CheckCheck className="w-2.5 h-2.5 text-gray-400" />}
                            </div>
                          </div>
                          {simState === "sending" && (
                            <div className="flex justify-end mt-1">
                              <div className="bg-[#00A884] text-white text-[7px] font-black px-2 py-0.5 rounded-full flex items-center gap-1 animate-bounce">
                                <span>SEND</span><span>→</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Contact Queue List */}
                  <div className="bg-white rounded border flex flex-col overflow-hidden shadow-sm flex-1">
                     <div className="px-1.5 py-1 border-b bg-[#F0F2F5] shrink-0 flex items-center justify-between">
                        <span className="font-black text-[7px] text-gray-500 uppercase tracking-widest">QUEUE</span>
                        <div className="flex items-center gap-1.5">
                           <span className="text-[7px] font-black text-gray-400">{contacts.filter(c => contactStatuses[c.phone] === 'sent').length}/{contacts.length}</span>
                           <button
                             onClick={async () => { await (window as any).api?.clearContacts(); setContactStatuses({}); loadData(); }}
                             className="flex items-center gap-0.5 px-1.5 py-0.5 bg-red-50 border border-red-200 text-red-400 hover:bg-red-100 hover:text-red-600 rounded text-[7px] font-black uppercase tracking-wider transition-colors"
                           >
                             <X className="w-2 h-2" /> CLEAR
                           </button>
                        </div>
                     </div>
                     <div className="flex-1 overflow-y-auto custom-scroll">
                        {contacts.length === 0 ? (
                           <div className="flex items-center justify-center h-full text-[8px] text-gray-300 font-black uppercase">No contacts queued</div>
                        ) : (
                           contacts.map((contact, i) => {
                              const st = contactStatuses[contact.phone] || contact.status || 'pending'
                              return (
                                 <div key={i} className="flex items-center gap-1.5 px-1.5 py-1 border-b border-black/[0.04] last:border-0">
                                    {/* Status indicator */}
                                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                       st === 'sent' ? 'bg-[#25D366]' :
                                       st === 'failed' ? 'bg-red-400' :
                                       st === 'sending' ? 'bg-yellow-400 animate-pulse' :
                                       'bg-gray-200'
                                    }`} />
                                    <span className="text-[8px] font-bold text-[#128C7E] truncate flex-1">+{contact.phone}</span>
                                    <span className="text-[7px] text-gray-300 truncate max-w-[40px]">{contact.name}</span>
                                    <span className={`text-[7px] font-black shrink-0 ${
                                       st === 'sent' ? 'text-[#25D366]' :
                                       st === 'failed' ? 'text-red-400' :
                                       st === 'sending' ? 'text-yellow-500' :
                                       'text-gray-300'
                                    }`}>
                                       {st === 'sent' ? '✓' : st === 'failed' ? '✗' : st === 'sending' ? '...' : '–'}
                                    </span>
                                 </div>
                              )
                           })
                        )}
                     </div>
                  </div>
               </section>
             )}

             {activeTab !== 'campaign' && activeTab !== 'generator' && activeTab !== 'history' && activeTab !== 'settings' && (
                <section className="flex-1 flex flex-col bg-white rounded border p-3 items-center justify-center text-gray-400">
                   <span className="font-black text-[10px] uppercase tracking-widest">{activeTab} MODULE</span>
                   <span className="text-[8px] mt-1 text-center">Coming soon.</span>
                </section>
              )}

              {activeTab === 'settings' && (
                <section className="flex-1 flex flex-col gap-1.5 min-w-0 overflow-hidden">
                  <div className="bg-white rounded border p-3 flex flex-col gap-3 shadow-sm overflow-y-auto flex-1">
                    <span className="font-black text-[10px] text-gray-400 uppercase tracking-widest">Send Settings</span>

                    <div>
                      <span className="text-[7px] font-black text-gray-400 uppercase block mb-1.5">Speed Preset</span>
                      <div className="flex gap-1.5">
                        {(['safe','normal','fast'] as const).map(p => (
                          <button key={p} onClick={() => applyPreset(p)} className={`flex-1 py-1.5 rounded text-[8px] font-black uppercase border transition-all ${speedPreset === p ? 'bg-[#00A884] text-white border-[#00A884]' : 'bg-gray-50 border-gray-200 text-gray-400'}`}>
                            {p === 'safe' ? 'Safe' : p === 'normal' ? 'Normal' : 'Fast'}
                          </button>
                        ))}
                      </div>
                      <span className="text-[6px] text-gray-300 mt-1 block">{speedPreset === 'safe' ? '90-180s - Safest' : speedPreset === 'normal' ? '45-120s - Balanced' : '20-45s - Fastest'}</span>
                    </div>

                    <div className="flex gap-2">
                      <div className="flex flex-col gap-1 flex-1">
                        <span className="text-[7px] font-black text-gray-400 uppercase">Min Delay (sec)</span>
                        <input type="number" value={minDelay} onChange={e => setMinDelay(parseInt(e.target.value)||30)} className="w-full p-1.5 border rounded text-[9px] font-bold outline-none focus:border-[#00A884]" />
                      </div>
                      <div className="flex flex-col gap-1 flex-1">
                        <span className="text-[7px] font-black text-gray-400 uppercase">Max Delay (sec)</span>
                        <input type="number" value={maxDelay} onChange={e => setMaxDelay(parseInt(e.target.value)||120)} className="w-full p-1.5 border rounded text-[9px] font-bold outline-none focus:border-[#00A884]" />
                      </div>
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="text-[7px] font-black text-gray-400 uppercase">Daily Send Limit</span>
                      <div className="flex items-center gap-2">
                        <input type="number" value={dailyLimit} onChange={e => setDailyLimit(parseInt(e.target.value)||300)} className="flex-1 p-1.5 border rounded text-[9px] font-bold outline-none focus:border-[#00A884]" />
                        <span className="text-[7px] text-gray-400 shrink-0">msgs/day</span>
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[7px] font-black text-gray-400 uppercase">Schedule (send only between)</span>
                        <button onClick={() => setScheduleEnabled(!scheduleEnabled)} className={`w-7 h-3.5 rounded-full relative ${scheduleEnabled ? 'bg-[#00A884]' : 'bg-gray-300'}`}><div className={`absolute top-0.5 w-2.5 h-2.5 bg-white rounded-full transition-transform ${scheduleEnabled ? 'left-4' : 'left-0.5'}`} /></button>
                      </div>
                      {scheduleEnabled && (
                        <div className="flex gap-2">
                          <input type="time" value={scheduleStart} onChange={e => setScheduleStart(e.target.value)} className="flex-1 p-1.5 border rounded text-[9px] font-bold outline-none focus:border-[#00A884]" />
                          <input type="time" value={scheduleEnd} onChange={e => setScheduleEnd(e.target.value)} className="flex-1 p-1.5 border rounded text-[9px] font-bold outline-none focus:border-[#00A884]" />
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[7px] font-black text-gray-400 uppercase">Auto Breaks</span>
                        <button onClick={() => setBreakEnabled(!breakEnabled)} className={`w-7 h-3.5 rounded-full relative ${breakEnabled ? 'bg-[#00A884]' : 'bg-gray-300'}`}><div className={`absolute top-0.5 w-2.5 h-2.5 bg-white rounded-full transition-transform ${breakEnabled ? 'left-4' : 'left-0.5'}`} /></button>
                      </div>
                      {breakEnabled && (
                        <div className="flex gap-2">
                          <div className="flex-1"><span className="text-[6px] text-gray-400">Every N msgs</span><input type="number" value={breakEvery} onChange={e => setBreakEvery(parseInt(e.target.value)||25)} className="w-full p-1.5 border rounded text-[9px] font-bold outline-none focus:border-[#00A884]" /></div>
                          <div className="flex-1"><span className="text-[6px] text-gray-400">Break (min)</span><input type="number" value={breakDuration} onChange={e => setBreakDuration(parseInt(e.target.value)||10)} className="w-full p-1.5 border rounded text-[9px] font-bold outline-none focus:border-[#00A884]" /></div>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-[7px] font-black text-gray-400 uppercase">Shuffle Contact Order</span>
                      <button onClick={() => setShuffleContacts(!shuffleContacts)} className={`w-7 h-3.5 rounded-full relative ${shuffleContacts ? 'bg-[#00A884]' : 'bg-gray-300'}`}><div className={`absolute top-0.5 w-2.5 h-2.5 bg-white rounded-full transition-transform ${shuffleContacts ? 'left-4' : 'left-0.5'}`} /></button>
                    </div>

                    <div className="border-t pt-3 flex flex-col gap-1">
                      <span className="font-black text-[9px] text-gray-500 uppercase">Anti-Ban Tips</span>
                      <ul className="text-[7px] text-gray-400 space-y-1 list-disc pl-3">
                        <li>Use numbers at least 3 months old</li>
                        <li>Start with 50/day, increase gradually</li>
                        <li>Keep Smart Twist ON always</li>
                        <li>Enable auto breaks</li>
                        <li>Use schedule to send during business hours only</li>
                      </ul>
                    </div>
                  </div>
                </section>
              )}

             {activeTab === 'history' && (
               <section className="flex-1 flex flex-col gap-1.5 min-w-0 overflow-hidden">
                  <div className="bg-white rounded border flex flex-col overflow-hidden shadow-sm flex-1">
                     <div className="px-1.5 py-1 border-b bg-[#F0F2F5] shrink-0 flex items-center justify-between">
                        <span className="font-black text-[7px] text-gray-500 uppercase tracking-widest">SEND HISTORY</span>
                        <div className="flex items-center gap-1.5">
                           <span className="text-[7px] font-black text-gray-400">{logs.length} entries</span>
                           <button
                             onClick={async () => { await (window as any).api?.clearLogs(); loadData(); }}
                             className="flex items-center gap-0.5 px-1.5 py-0.5 bg-red-50 border border-red-200 text-red-400 hover:bg-red-100 rounded text-[7px] font-black uppercase transition-colors"
                           >
                             <X className="w-2 h-2" /> CLEAR
                           </button>
                        </div>
                     </div>

                     {/* Stats bar */}
                     {logs.length > 0 && (
                        <div className="px-2 py-1 border-b bg-[#F8F9FA] shrink-0 flex items-center gap-3">
                           <div className="flex items-center gap-1">
                              <div className="w-1.5 h-1.5 rounded-full bg-[#25D366]" />
                              <span className="text-[7px] font-black text-gray-500">SENT: {logs.filter((l: any) => l.status === 'sent').length}</span>
                           </div>
                           <div className="flex items-center gap-1">
                              <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
                              <span className="text-[7px] font-black text-gray-500">FAILED: {logs.filter((l: any) => l.status === 'failed').length}</span>
                           </div>
                           <div className="ml-auto text-[7px] font-black text-[#00A884]">
                              {logs.length > 0 ? Math.round((logs.filter((l: any) => l.status === 'sent').length / logs.length) * 100) : 0}% success
                           </div>
                        </div>
                     )}

                     <div className="flex-1 overflow-y-auto custom-scroll">
                        {logs.length === 0 ? (
                           <div className="flex flex-col items-center justify-center h-full text-gray-300 gap-1">
                              <History className="w-6 h-6" />
                              <span className="text-[8px] font-black uppercase">No history yet</span>
                              <span className="text-[7px]">Send a campaign to see logs here</span>
                           </div>
                        ) : (
                           logs.map((log: any, i: number) => (
                              <div key={i} className="flex items-center gap-1.5 px-2 py-1.5 border-b border-black/[0.04] last:border-0">
                                 <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${log.status === 'sent' ? 'bg-[#25D366]' : 'bg-red-400'}`} />
                                 <div className="flex flex-col flex-1 min-w-0">
                                    <span className="text-[9px] font-bold text-[#128C7E] truncate">+{log.phone}</span>
                                    {log.error && <span className="text-[7px] text-red-400 truncate">{log.error}</span>}
                                 </div>
                                 <div className="flex flex-col items-end shrink-0 gap-0.5">
                                    <span className={`text-[7px] font-black ${log.status === 'sent' ? 'text-[#25D366]' : 'text-red-400'}`}>
                                       {log.status === 'sent' ? '✓ SENT' : '✗ FAIL'}
                                    </span>
                                    <span className="text-[6px] text-gray-300 font-mono">
                                       {new Date(log.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                 </div>
                              </div>
                           ))
                        )}
                     </div>
                  </div>
               </section>
             )}

             {activeTab === 'accounts' && (
               <section className="flex-1 flex flex-col gap-1.5 min-w-0 overflow-hidden">
                 <div className="bg-white rounded border flex flex-col overflow-hidden shadow-sm flex-1">
                   <div className="px-1.5 py-1 border-b bg-[#F0F2F5] shrink-0 flex items-center justify-between">
                     <span className="font-black text-[7px] text-gray-500 uppercase tracking-widest">WhatsApp Accounts</span>
                     <span className="text-[7px] font-black text-[#00A884]">{readyAccounts().length}/{accounts.length} LIVE</span>
                   </div>
                   <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5 custom-scroll">
                     {accounts.map((acc: any) => {
                       const s = accountStatuses[acc.id] || {}
                       return (
                         <div key={acc.id} className="border rounded p-1.5 bg-[#F8F9FA]">
                           <div className="flex items-center justify-between mb-1">
                             <div className="flex items-center gap-1">
                               <div className={`w-1.5 h-1.5 rounded-full ${s.isReady ? 'bg-[#25D366]' : s.isAuthenticated ? 'bg-yellow-400' : 'bg-gray-300'}`} />
                               <span className="font-black text-[8px] text-gray-700">{acc.label || acc.id}</span>
                               {s.phone && <span className="text-[7px] text-gray-400">+{s.phone}</span>}
                             </div>
                             <div className="flex items-center gap-1">
                               {!s.isReady && (
                                 <button onClick={() => handleConnectAccount(acc.id)}
                                   className="px-1.5 py-0.5 bg-[#00A884] text-white rounded text-[7px] font-black uppercase hover:bg-[#009272] active:scale-95 transition-all flex items-center gap-0.5">
                                   <RefreshCw className="w-2 h-2" /> SCAN
                                 </button>
                               )}
                               {s.isReady && (
                                 <button onClick={() => handleDisconnectAccount(acc.id)}
                                   className="px-1.5 py-0.5 bg-red-50 border border-red-200 text-red-400 rounded text-[7px] font-black uppercase hover:bg-red-100 transition-all">
                                   UNLINK
                                 </button>
                               )}
                               <button onClick={() => handleRemoveAccount(acc.id)}
                                 className="p-0.5 text-gray-300 hover:text-red-400 transition-colors">
                                 <X className="w-3 h-3" />
                               </button>
                             </div>
                           </div>
                           {/* QR Code */}
                           {s.qrCode && !s.isReady && (
                             <div className="flex flex-col items-center py-1">
                               <img src={s.qrCode} alt="QR" className="w-28 h-28 rounded border shadow-sm" />
                               <p className="text-[7px] text-gray-400 mt-0.5 font-black uppercase">Scan with WhatsApp</p>
                             </div>
                           )}
                           {!s.qrCode && !s.isReady && !s.isAuthenticated && (
                             <p className="text-[7px] text-gray-400 text-center py-1">Click SCAN to connect</p>
                           )}
                           {s.isReady && (
                             <div className="flex items-center gap-1 mt-0.5">
                               <CheckCheck className="w-2.5 h-2.5 text-[#25D366]" />
                               <span className="text-[7px] text-[#25D366] font-black">Connected — ready to send</span>
                               {s.dailySent > 0 && <span className="text-[7px] text-gray-400 ml-auto">{s.dailySent} sent today</span>}
                             </div>
                           )}
                         </div>
                       )
                     })}
                     {accounts.length === 0 && (
                       <div className="text-center py-6 text-[8px] text-gray-400 font-black uppercase">No accounts yet — add one below</div>
                     )}
                   </div>
                   {/* Add account */}
                   <div className="border-t p-1.5 shrink-0 flex items-center gap-1">
                     <input
                       value={newAccountLabel}
                       onChange={e => setNewAccountLabel(e.target.value)}
                       onKeyDown={e => e.key === 'Enter' && handleAddAccount()}
                       placeholder="Label (e.g. Account 2)"
                       className="flex-1 p-1 border rounded text-[8px] font-bold outline-none focus:border-[#00A884]"
                     />
                     <button onClick={handleAddAccount} disabled={addingAccount}
                       className="px-2 py-1 bg-[#00A884] text-white rounded font-black text-[8px] uppercase disabled:opacity-40 active:scale-95 transition-all flex items-center gap-0.5">
                       <Plus className="w-2.5 h-2.5" /> ADD
                     </button>
                   </div>
                 </div>
               </section>
             )}

             {activeTab === 'generator' && (
               <section className="flex-1 flex flex-col gap-1.5 min-w-0 overflow-hidden">
                  {/* Controls */}
                  <div className="bg-white rounded border p-2 shadow-sm shrink-0">
                     <div className="flex items-center justify-between mb-1.5">
                        <span className="font-black text-[10px] text-gray-400 uppercase tracking-widest">Lead Extractor</span>
                        <span className="text-[8px] font-black text-[#00A884]">{extractionResults.length} found</span>
                     </div>
                     <div className="flex gap-1 mb-1">
                        <div className="flex flex-col gap-0.5 flex-1">
                           <span className="text-[7px] font-black text-gray-400 uppercase">Country Code</span>
                           <input value={countryCode} onChange={e => setCountryCode(e.target.value)} className="w-full p-1 border text-[9px] rounded font-bold outline-none focus:border-[#00A884]" placeholder="234" />
                        </div>
                        <div className="flex flex-col gap-0.5 flex-1">
                           <span className="text-[7px] font-black text-gray-400 uppercase">Quantity</span>
                           <input type="number" value={quantity} onChange={e => setQuantity(parseInt(e.target.value))} className="w-full p-1 border text-[9px] rounded font-bold outline-none focus:border-[#00A884]" />
                        </div>
                     </div>
                     <div className="flex flex-col gap-0.5 mb-1.5">
                        <span className="text-[7px] font-black text-gray-400 uppercase">Start Number</span>
                        <input value={startNumber} onChange={e => setStartNumber(e.target.value)} placeholder="e.g. 8031234567" className="w-full p-1 border text-[9px] rounded font-bold outline-none focus:border-[#00A884]" />
                     </div>
                     <div className="flex gap-1">
                        <button
                          onClick={isVerifying ? handleStopVerification : handleGenerateNumbers}
                          className={`flex-1 py-1.5 rounded text-[9px] font-black uppercase tracking-widest text-white ${isVerifying ? 'bg-red-500' : 'bg-[#2563EB] hover:bg-[#1d4ed8]'} transition-colors`}
                        >
                          {isVerifying ? 'STOP' : 'EXTRACT'}
                        </button>
                        {extractionResults.length > 0 && (
                          <>
                            <button onClick={handleExportLeads} className="px-2 py-1.5 rounded bg-gray-100 text-gray-500 font-black text-[8px] uppercase hover:bg-gray-200 transition-colors">CSV</button>
                            <button onClick={handleTransferToCampaign} className="px-2 py-1.5 rounded bg-[#00A884] text-white font-black text-[8px] uppercase hover:bg-[#009272] transition-colors">→ Campaign</button>
                          </>
                        )}
                     </div>
                     {isVerifying && (
                        <div className="mt-1.5 w-full bg-gray-100 rounded-full h-1 overflow-hidden">
                           <div className="h-full bg-[#2563EB] animate-pulse rounded-full" style={{width: `${Math.min((extractionResults.length / quantity) * 100, 100)}%`}} />
                        </div>
                     )}
                  </div>

                  {/* Results List */}
                  <div className="bg-white rounded border flex flex-col overflow-hidden shadow-sm flex-1">
                     <div className="px-1.5 py-1 border-b bg-[#F0F2F5] shrink-0 flex items-center justify-between">
                        <span className="font-black text-[7px] text-gray-500 uppercase tracking-widest">ACTIVE LEADS</span>
                        {extractionResults.length > 0 && (
                           <button onClick={() => setExtractionResults([])} className="flex items-center gap-0.5 px-1.5 py-0.5 bg-red-50 border border-red-200 text-red-400 hover:bg-red-100 rounded text-[7px] font-black uppercase transition-colors">
                              <X className="w-2 h-2" /> CLEAR
                           </button>
                        )}
                     </div>
                     <div className="flex-1 overflow-y-auto custom-scroll">
                        {extractionResults.length === 0 ? (
                           <div className="flex flex-col items-center justify-center h-full text-gray-300 gap-1">
                              <UserPlus className="w-6 h-6" />
                              <span className="text-[8px] font-black uppercase">No leads yet</span>
                              <span className="text-[7px]">Set params and hit EXTRACT</span>
                           </div>
                        ) : (
                           extractionResults.map((lead, i) => (
                              <div key={i} className="flex items-center gap-2 px-2 py-1 border-b border-black/[0.04] last:border-0">
                                 <CheckCheck className="w-2.5 h-2.5 text-[#25D366] shrink-0" />
                                 <span className="text-[9px] font-bold text-[#128C7E] flex-1">+{lead.phone}</span>
                                 <span className="text-[7px] text-gray-300">{lead.name}</span>
                              </div>
                           ))
                        )}
                     </div>
                  </div>
               </section>
             )}

             {/* Lead Results sidebar — only show on campaign tab */}
             {activeTab === 'campaign' && (
               <aside className="w-[110px] bg-white rounded border flex flex-col overflow-hidden shrink-0 shadow-sm">
                <div className="p-1 px-1.5 border-b bg-[#F0F2F5] shrink-0 flex items-center justify-between text-[7px] font-black">
                   <span className="text-gray-500 uppercase">LEADS</span>
                   <span className="text-[#00A884]">{extractionResults.length}</span>
                </div>
                <div className="p-1 border-b bg-[#F8F9FA] space-y-1 shrink-0">
                   <div className="flex gap-1">
                      <input value={countryCode} onChange={e => setCountryCode(e.target.value)} className="w-1/2 p-0.5 border text-[9px] rounded font-bold outline-none" placeholder="234" />
                      <input type="number" value={quantity} onChange={e => setQuantity(parseInt(e.target.value))} className="w-1/2 p-0.5 border text-[9px] rounded font-bold outline-none" />
                   </div>
                   <input value={startNumber} onChange={e => setStartNumber(e.target.value)} placeholder="0803..." className="w-full p-0.5 border text-[9px] rounded font-bold outline-none" />
                   <button onClick={isVerifying ? handleStopVerification : handleGenerateNumbers} className="w-full py-1 bg-[#2563EB] text-white rounded text-[8px] font-black uppercase tracking-widest">{isVerifying ? 'STOP' : 'EXTRACT'}</button>
                   {extractionResults.length > 0 && (
                      <div className="flex gap-1 mt-1">
                         <button onClick={handleExportLeads} className="flex-1 py-1 rounded bg-gray-200 text-gray-500 font-black text-[7px] uppercase tracking-widest cursor-pointer hover:bg-gray-300 transition-colors">CSV</button>
                         <button onClick={handleTransferToCampaign} className="flex-1 py-1 rounded bg-[#00A884] text-white font-black text-[7px] uppercase tracking-widest cursor-pointer hover:bg-[#009272] transition-colors">Transfer</button>
                      </div>
                   )}
                </div>
                <div className="flex-1 overflow-y-auto p-1 space-y-1 bg-[#F8F9FA] custom-scroll">
                   {extractionResults.map((lead, i) => (
                      <div key={i} className="bg-white p-1 rounded border border-black/5 flex items-center justify-between text-[8px] font-bold">
                         <span className="truncate">+{lead.phone}</span>
                         <CheckCheck className="w-2 h-2 text-[#25D366]" />
                      </div>
                   ))}
                </div>
             </aside>
             )}
          </div>

          {/* Delivery Feed */}
          <div className="h-28 bg-white border-t mt-auto flex flex-col overflow-hidden shrink-0 shadow-md">
             <div className="px-2 py-0.5 border-b bg-[#F0F2F5]/50 flex items-center justify-between shrink-0 font-black text-[7px] text-gray-400 tracking-widest uppercase">
                <span>FEED</span>
                <button onClick={async () => { await (window as any).api.clearLogs(); loadData(); }} className="text-red-400 scale-90">X</button>
             </div>
             <div className="flex-1 overflow-y-auto p-1.5 space-y-1 bg-[#F8F9FA] custom-scroll">
                {logs.map((log: any, i: number) => (
                   <div key={i} className="flex items-center gap-1.5 border-b border-black/[0.02] pb-0.5 last:border-0 text-[8px] font-bold">
                      <span className="text-gray-300 flex-shrink-0 font-mono text-[7px]">{new Date(log.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                      <span className="text-[#128C7E] flex-shrink-0">+{log.phone}</span>
                      <span className="text-gray-400 italic truncate flex-1">&ldquo;{log.message || '...'}&rdquo;</span>
                      <span className={`${log.status === 'sent' ? 'text-[#00A884]' : 'text-red-500'} flex-shrink-0 text-[7px]`}>{log.status === 'sent' ? 'OK' : 'FAIL'}</span>
                   </div>
                ))}
                <div ref={logEndRef} />
             </div>
          </div>
        </div>
      </div>

      {/* License Gate — shown when trial expires */}
      {license?.trialExpired && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-[200px] overflow-hidden shadow-2xl">
            <div className="p-2 bg-[#128C7E] text-white text-center font-black text-[9px] uppercase tracking-widest">LICENSE REQUIRED</div>
            <div className="p-4 flex flex-col gap-3">
              <div className="text-center">
                <div className="text-2xl mb-1">🔒</div>
                <p className="text-[8px] font-black text-gray-500 uppercase tracking-wide">Trial period expired</p>
                <p className="text-[7px] text-gray-400 mt-0.5">Send your Machine ID to the developer</p>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[7px] font-black text-gray-400 uppercase">Your Machine ID</span>
                <div
                  className="bg-gray-50 border rounded p-1.5 font-mono text-[7px] text-gray-600 break-all cursor-pointer select-all"
                  onClick={() => navigator.clipboard.writeText(license.machineId)}
                  title="Click to copy"
                >
                  {license.machineId}
                </div>
                <p className="text-[6px] text-gray-300 text-center">Click to copy</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <input
                  value={licenseKey}
                  onChange={e => setLicenseKey(e.target.value)}
                  placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
                  className="w-full p-1.5 border rounded text-[9px] font-bold outline-none focus:border-[#00A884] font-mono"
                />
                {licenseError && <p className="text-[7px] text-red-500 font-black">{licenseError}</p>}
                <button
                  onClick={handleActivateLicense}
                  className="w-full py-1.5 bg-[#00A884] text-white rounded font-black text-[9px] uppercase tracking-widest hover:bg-[#009272] transition-colors"
                >
                  ACTIVATE
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Connection Modal */}
      {isConnectModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
           <div className="bg-white rounded-xl w-[180px] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
              <div className="p-2 bg-[#00A884] text-white text-center font-black text-[9px] uppercase tracking-widest">WHATSAPP LINK</div>
              <div className="p-4 flex flex-col items-center gap-4">
                 {status.qrCode ? (
                    <div className="p-1 border rounded bg-white shadow-inner animate-in fade-in zoom-in-50">
                      <img src={status.qrCode} alt="QR" className="w-32 h-32" />
                    </div>
                 ) : (
                    <div className="w-32 h-32 flex flex-col items-center justify-center gap-2">
                      <div className="w-8 h-8 border-2 border-[#00A884] border-t-transparent rounded-full animate-spin" />
                      <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest text-center">Generating<br/>QR Code...</span>
                    </div>
                 )}
                 <button onClick={() => setIsConnectModalOpen(false)} className="w-full py-1.5 bg-gray-50 text-gray-400 rounded-lg text-[8px] font-black uppercase tracking-widest hover:bg-gray-100 transition-colors">Cancel</button>
              </div>
           </div>
        </div>
      )}

      {error && (
        <div className="fixed bottom-2 left-2 right-2 bg-red-600 text-white p-1.5 rounded shadow-xl flex items-center gap-2 z-[60] text-[8px] font-black animate-in slide-in-from-bottom-2">
           <AlertCircle className="w-2.5 h-2.5 shrink-0" />
           <p className="flex-1 truncate uppercase tracking-tighter">{error}</p>
           <button onClick={() => setError(null)}><X className="w-2.5 h-2.5" /></button>
        </div>
      )}

      {success && (
        <div className="fixed bottom-2 left-2 right-2 bg-[#00A884] text-white p-1.5 rounded shadow-xl flex items-center gap-2 z-[60] text-[8px] font-black animate-in slide-in-from-bottom-2">
           <CheckCheck className="w-2.5 h-2.5 shrink-0" />
           <p className="flex-1 truncate uppercase tracking-tighter">{success}</p>
           <button onClick={() => setSuccess(null)}><X className="w-2.5 h-2.5" /></button>
        </div>
      )}

    </div>
  )
}

export default App
