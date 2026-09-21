import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, dialog } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { getTenants, getStoreStats, getDailyData, getAlerts, testConnection, prefetchAll, invalidateCache, MissingTokenError } from './db'

process.on('uncaughtException', (err) => {
  dialog.showErrorBox('Erro Opero Finance', err.stack ?? err.message)
})

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.stack ?? reason.message : String(reason)
  dialog.showErrorBox('Erro Opero Finance', msg)
})

// Single instance lock — second launch focuses existing window
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
  process.exit(0)
}

// Clicking the shortcut while the app sits in the tray must surface the existing
// window — without this the second instance just dies and nothing appears.
app.on('second-instance', () => openWindow('home'))

// ─── Local state file ─────────────────────────────────────────────────────────

function getConfigDir() { return join(app.getPath('userData'), 'opero-finance') }
function getConfigFile() { return join(getConfigDir(), 'state.json') }

function readState(): Record<string, unknown> {
  try {
    const dir = getConfigDir()
    const file = getConfigFile()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    if (!existsSync(file)) return {}
    return JSON.parse(readFileSync(file, 'utf-8'))
  } catch { return {} }
}

function writeState(data: Record<string, unknown>) {
  const dir = getConfigDir()
  const file = getConfigFile()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(file, JSON.stringify(data, null, 2))
}

// ─── Window & tray ───────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

function createTrayIcon(): Electron.NativeImage {
  const size = 32
  const buf = Buffer.alloc(size * size * 4)
  const cx = size / 2, cy = size / 2, r = size / 2 - 1

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4
      const inside = (x - cx) ** 2 + (y - cy) ** 2 <= r ** 2
      if (inside) {
        buf[idx]     = 34   // R
        buf[idx + 1] = 197  // G  → #22c55e (verde)
        buf[idx + 2] = 94   // B
        buf[idx + 3] = 255  // A
      }
    }
  }

  return nativeImage.createFromBitmap(buf, { width: size, height: size })
}

function createWindow(route: 'briefing' | 'home' | 'dashboard') {
  mainWindow = new BrowserWindow({
    width: route === 'briefing' ? 900 : 1300,
    height: route === 'briefing' ? 600 : 820,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#0d0d10',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0d0d10',
      symbolColor: '#888',
      height: 40
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    show: true
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '#' + route)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: route })
  }

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    dialog.showErrorBox('Erro ao carregar interface', `${desc}\n\n${url}`)
  })

  // Minimize to tray instead of closing
  mainWindow.on('close', e => {
    e.preventDefault()
    mainWindow?.hide()
  })
}

function createTray() {
  tray = new Tray(createTrayIcon())
  tray.setToolTip('Opero Finance')

  const menu = Menu.buildFromTemplate([
    { label: 'Abrir Início', click: () => { openWindow('home') } },
    { label: 'Briefing de hoje', click: () => { openWindow('briefing') } },
    { type: 'separator' },
    { label: 'Sair', click: () => { app.quit() } }
  ])

  tray.setContextMenu(menu)
  tray.on('click', () => openWindow('home'))
}

function openWindow(route: 'briefing' | 'home' | 'dashboard') {
  if (!mainWindow) {
    createWindow(route)
  } else {
    mainWindow.show()
    mainWindow.focus()
    if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
      mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '#' + route)
    } else {
      mainWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: route })
    }
  }
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

function registerIPC() {
  ipcMain.handle('test-connection', () => testConnection())

  ipcMain.handle('get-tenants', () => getTenants())

  ipcMain.handle('get-store-stats', async (_e, tenantId: string, dateFrom: string, dateTo: string) => {
    const tenants = await getTenants()
    const tenant = tenants.find(t => t.id === tenantId)
    if (!tenant) throw new Error('Tenant not found')
    return getStoreStats(tenant, dateFrom, dateTo)
  })

  ipcMain.handle('get-all-stores-stats', async (_e, dateFrom: string, dateTo: string) => {
    const tenants = await getTenants()
    return Promise.all(tenants.map(t => getStoreStats(t, dateFrom, dateTo)))
  })

  ipcMain.handle('get-daily-data', async (_e, tenantId: string, days: number) => {
    const tenants = await getTenants()
    const tenant = tenants.find(t => t.id === tenantId)
    if (!tenant) throw new Error('Tenant not found')
    return getDailyData(tenant, days)
  })

  ipcMain.handle('get-alerts', async () => {
    const tenants = await getTenants()
    return getAlerts(tenants)
  })

  ipcMain.handle('get-state', () => readState())

  ipcMain.handle('set-state', (_e, data: Record<string, unknown>) => {
    const current = readState()
    writeState({ ...current, ...data })
  })

  ipcMain.handle('open-url', (_e, url: string) => shell.openExternal(url))

  ipcMain.handle('refresh-cache', async () => {
    invalidateCache()
    const ts = await getTenants()
    await prefetchAll(ts)
  })
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true })
  }

  registerIPC()

  // Warm cache in background so first page load is instant. A missing token is
  // the one failure the user has to act on, so it gets said out loud instead of
  // leaving every page silently empty.
  getTenants()
    .then(ts => prefetchAll(ts))
    .catch(err => {
      if (err instanceof MissingTokenError) dialog.showErrorBox('Opero Finance', err.message)
    })

  try {
    createTray()
  } catch (e) {
    console.error('Tray creation failed (continuing without tray):', e)
  }

  const state = readState()
  const today = new Date().toISOString().slice(0, 10)
  const briefingSeenToday = state['briefingDate'] === today

  // Always show a window at startup, login included — this is meant to be the
  // first thing on screen, so starting silently in the tray defeats the point.
  createWindow(briefingSeenToday ? 'home' : 'briefing')
})

app.on('window-all-closed', () => {
  // Keep running in tray — do NOT quit
})

app.on('activate', () => {
  openWindow('home')
})
