// Focus Corner — main process
// Owns the floating window, its position in the corner, the tray icon and the global shortcut.

const { app, BrowserWindow, ipcMain, screen, Tray, Menu, globalShortcut, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// Window sizes for each state. Each includes 8px of transparent padding so the shadow isn't clipped.
const SIZES = {
  pill: { width: 300, height: 76 },
  bubble: { width: 84, height: 84 },
  tab: { width: 40, height: 136 },
  expanded: { width: 392, height: 660 },
};
const EDGE_GAP = 8; // extra gap between the widget and the screen edge
const SHORTCUT = 'CommandOrControl+Shift+Space';
const IS_MAC = process.platform === 'darwin';

let win = null;
let tray = null;
let mode = 'pill';
let anchor = null; // { right, top } — the widget grows/shrinks from this top-right point
let status = { running: false, label: '', modeLabel: '' };
let programmaticMove = false;
let moveTimer = null;

// Only one copy of the widget at a time.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

/* ---------- position memory ---------- */

const statePath = () => path.join(app.getPath('userData'), 'window-state.json');

function loadAnchor() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8')).anchor || null;
  } catch {
    return null;
  }
}

function saveAnchor() {
  try {
    fs.writeFileSync(statePath(), JSON.stringify({ anchor }));
  } catch {
    /* non-fatal */
  }
}

function defaultAnchor() {
  const wa = screen.getPrimaryDisplay().workArea;
  return { right: wa.x + wa.width - EDGE_GAP, top: wa.y + EDGE_GAP };
}

// Places the window for the current mode, keeping its top-right corner pinned to the anchor.
function applyBounds() {
  if (!win) return;
  const size = SIZES[mode] || SIZES.pill;
  const display = screen.getDisplayNearestPoint({ x: Math.round(anchor.right - 1), y: Math.round(anchor.top) });
  const wa = display.workArea;

  // The edge tab always hugs the right edge of the screen.
  let x = mode === 'tab' ? wa.x + wa.width - size.width : anchor.right - size.width;
  let y = anchor.top;
  x = Math.min(Math.max(x, wa.x), wa.x + wa.width - size.width);
  y = Math.min(Math.max(y, wa.y), wa.y + wa.height - size.height);

  programmaticMove = true;
  win.setResizable(true); // some platforms refuse setBounds on non-resizable windows
  win.setBounds({ x: Math.round(x), y: Math.round(y), width: size.width, height: size.height });
  win.setResizable(false);
  setTimeout(() => (programmaticMove = false), 250);
}

/* ---------- window ---------- */

function createWindow() {
  anchor = loadAnchor() || defaultAnchor();
  const size = SIZES.pill;

  win = new BrowserWindow({
    width: size.width,
    height: size.height,
    x: Math.round(anchor.right - size.width),
    y: Math.round(anchor.top),
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    acceptFirstMouse: true, // macOS: the first click on the widget acts immediately
    backgroundColor: '#00000000',
    title: 'Focus Corner',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required', // lets the end-of-session chime play
    },
  });

  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // showInactive: appear without stealing focus from whatever you're working on.
  win.once('ready-to-show', () => {
    applyBounds();
    win.showInactive();
  });

  // Remember where the person drags the widget (ignoring our own resizes).
  win.on('move', () => {
    if (programmaticMove || mode === 'tab') return;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      if (programmaticMove || !win) return;
      const b = win.getBounds();
      anchor = { right: b.x + b.width, top: b.y };
      saveAnchor();
    }, 300);
  });

  win.on('blur', () => send('blur'));
  win.on('show', refreshTray);
  win.on('hide', refreshTray);
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function showWidget({ expand = false } = {}) {
  if (!win) return;
  if (expand) {
    win.show();
    send('command', 'expand');
  } else {
    win.showInactive();
  }
}

function hideWidget() {
  if (!win) return;
  send('command', 'collapse');
  win.hide();
}

function toggleVisible() {
  if (!win) return;
  if (win.isVisible()) hideWidget();
  else showWidget();
}

/* ---------- tray / menu bar ---------- */

function trayImage() {
  // macOS uses a black "template" image that adapts to light/dark menu bars.
  const file = IS_MAC ? 'trayTemplate.png' : 'tray.png';
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', file));
  if (IS_MAC) img.setTemplateImage(true);
  return img;
}

function refreshTray() {
  if (!tray || !win) return;
  const visible = win.isVisible();
  const items = [
    { label: visible ? 'Hide widget' : 'Show widget', accelerator: SHORTCUT, click: toggleVisible },
    { label: 'Open to-do list', click: () => showWidget({ expand: true }) },
    { label: status.running ? 'Pause timer' : 'Start timer', click: () => send('command', 'toggle-timer') },
    { type: 'separator' },
    {
      label: 'Move back to top-right corner',
      click: () => {
        anchor = defaultAnchor();
        saveAnchor();
        applyBounds();
        showWidget();
      },
    },
  ];
  if (process.platform !== 'linux') {
    items.push({
      label: 'Open at login',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    });
  }
  items.push({ type: 'separator' }, { label: 'Quit Focus Corner', click: () => app.quit() });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function createTray() {
  tray = new Tray(trayImage());
  tray.setToolTip('Focus Corner');
  // On Windows/Linux a left-click toggles the widget; right-click opens the menu.
  if (!IS_MAC) tray.on('click', toggleVisible);
  refreshTray();
}

/* ---------- messages from the widget ---------- */

ipcMain.on('set-mode', (_e, next) => {
  if (!SIZES[next] || !win) return;
  mode = next;
  applyBounds();
  if (next === 'expanded') {
    if (IS_MAC) app.focus({ steal: true });
    win.focus(); // so you can type a task straight away
  }
});

ipcMain.on('hide', hideWidget);
ipcMain.on('quit', () => app.quit());
ipcMain.on('always-on-top', (_e, on) => win && win.setAlwaysOnTop(!!on, 'floating'));
ipcMain.on('launch-at-login', (_e, on) => {
  if (process.platform !== 'linux') app.setLoginItemSettings({ openAtLogin: !!on });
  refreshTray();
});
ipcMain.handle('get-launch-at-login', () =>
  process.platform === 'linux' ? false : app.getLoginItemSettings().openAtLogin
);

ipcMain.on('status', (_e, next) => {
  const runningChanged = next.running !== status.running;
  status = next;
  if (!tray) return;
  tray.setToolTip(next.running ? `Focus Corner — ${next.modeLabel} ${next.label}` : 'Focus Corner');
  // macOS shows the countdown right in the menu bar while a session runs.
  if (IS_MAC) tray.setTitle(next.running ? ` ${next.label}` : '', { fontType: 'monospacedDigit' });
  if (runningChanged) refreshTray();
});

/* ---------- app lifecycle ---------- */

app.whenReady().then(() => {
  if (IS_MAC && app.dock) app.dock.hide(); // widget-style app: lives in the menu bar, not the Dock

  createWindow();
  createTray();

  globalShortcut.register(SHORTCUT, () => {
    if (!win) return;
    if (!win.isVisible()) showWidget({ expand: true });
    else if (mode !== 'expanded') showWidget({ expand: true });
    else hideWidget();
  });

  // Keep the widget on-screen when monitors are plugged/unplugged or resolution changes.
  const reposition = () => {
    const onScreen = screen.getAllDisplays().some((d) => {
      const wa = d.workArea;
      return anchor.right > wa.x && anchor.right <= wa.x + wa.width + 1 && anchor.top >= wa.y && anchor.top < wa.y + wa.height;
    });
    if (!onScreen) anchor = defaultAnchor();
    applyBounds();
  };
  screen.on('display-removed', reposition);
  screen.on('display-metrics-changed', reposition);
});

app.on('second-instance', () => showWidget({ expand: true }));
app.on('will-quit', () => globalShortcut.unregisterAll());
// Hiding the widget never closes the app; quit from the tray or settings.
app.on('window-all-closed', () => {});
