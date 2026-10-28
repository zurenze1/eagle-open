const { app, BrowserWindow, ipcMain, dialog, protocol, net, nativeImage, shell, Menu, screen } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Library, safeFile } = require('./library.cjs');
const { mediaResponse } = require('./media.cjs');
const run = promisify(execFile);
app.setName('Eagle 开源');
const projectRoot = app.isPackaged ? require('../workspace.json').projectRoot : path.resolve(__dirname, '../..');
const dataRoot = process.env.EAGLE_OPEN_DATA || path.join(projectRoot, 'data');
app.setPath('userData', path.join(dataRoot, 'runtime'));
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'asset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);
let win, library;
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
async function thumbnailer(item) {
  const result = {};
  if (['image','video'].includes(item.kind)) {
    const dest = path.join(item.itemRoot, 'thumbnail.png');
    try {
      const image = await nativeImage.createThumbnailFromPath(item.filePath, { width: 600, height: 600 });
      if (!image.isEmpty()) { await fs.writeFile(dest, image.toPNG()); result.thumbPath = dest; }
    } catch { /* 下方使用本机解码器补充 */ }
    if (!result.thumbPath && item.kind === 'video') {
      try { await run(ffmpeg, ['-v','error','-i',item.filePath,'-frames:v','1','-vf','scale=600:600:force_original_aspect_ratio=decrease',dest], { timeout: 30000 }); result.thumbPath = dest; }
      catch { /* 预览仍可播放，不伪造缩略图 */ }
    }
    if (item.kind === 'image') {
      const image = nativeImage.createFromPath(item.filePath); if (!image.isEmpty()) Object.assign(result, image.getSize());
    }
  }
  if (['video','audio'].includes(item.kind)) {
    try {
      const { stdout } = await run(ffprobe, ['-v','error','-show_entries','format=duration:stream=width,height','-of','json',item.filePath], { timeout: 15000 });
      const info = JSON.parse(stdout); result.duration = Number(info.format?.duration) || 0;
      const stream = info.streams?.find(s => s.width); if (stream) { result.width = stream.width; result.height = stream.height; }
    } catch { /* 可选本机 ffprobe 不存在时不影响导入 */ }
  }
  return result;
}
function registerIPC() {
  const handle = (name, fn) => ipcMain.handle(name, async (event,...args) => {
    if (event.sender !== win?.webContents || event.senderFrame?.url !== 'app://ui/index.html') throw new Error('拒绝不可信页面调用');
    return fn(...args);
  });
  handle('summary', () => library.summary());
  handle('query', args => library.query(args));
  handle('item', id => library.publicItem(library.get(id)));
  handle('edit', (ids, patch) => library.edit(ids, patch));
  handle('create-folder', (name,parent) => library.createFolder(name,parent));
  handle('preferences', values => library.savePreferences(values));
  handle('refresh', () => library.refresh());
  handle('connect-source', async () => {
    const result = await dialog.showOpenDialog(win, { title: '选择 Eagle 原素材库（只读接入）', properties: ['openDirectory','treatPackageAsDirectory'], buttonLabel: '只读接入' });
    if (!result.canceled) return library.connectSource(result.filePaths[0]);
    return null;
  });
  const importFiles = (paths, folder) => library.importPaths(paths, folder, progress => win?.webContents.send('import-progress',progress));
  handle('choose-import', async (type, folder) => {
    const result = await dialog.showOpenDialog(win, { title: type === 'folder' ? '导入文件夹，保留层级' : '导入素材', properties: type === 'folder' ? ['openDirectory'] : ['openFile','multiSelections'] });
    return result.canceled ? null : importFiles(result.filePaths, folder);
  });
  handle('drop-import', (paths,folder) => importFiles(paths,folder));
  handle('reveal', async id => { const file = await library.assetPath(id,'original'); shell.showItemInFolder(file); });
  handle('open-file', async id => {
    const item = library.get(id);
    // 不允许把脚本、应用或可执行格式从预览按钮直接执行。
    if (!['image','video','audio','font'].includes(item.kind) && item.ext !== 'pdf') throw new Error('此格式仅支持在 Finder 中显示');
    const message = await shell.openPath(await library.assetPath(id,'original')); if (message) throw new Error(message);
  });
}
async function createWindow() {
  const area = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({ width: Math.min(1440,area.width-32), height: Math.min(920,area.height-32), minWidth: 1080, minHeight: 660, backgroundColor: '#191a1e',
    title: 'Eagle 开源', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 17, y: 17 },
    webPreferences: { preload: path.join(__dirname,'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc,_permission,callback) => callback(false));
  const window = win;
  let closing = false;
  window.on('close', event => {
    if (closing) return;
    event.preventDefault();
    // 关闭时把仍处于输入状态的名称与描述保存，再结束进程。
    window.webContents.executeJavaScript('window.flushPendingEdits ? window.flushPendingEdits() : Promise.resolve()')
      .then(() => { closing = true; window.close(); })
      .catch(error => dialog.showErrorBox('更改尚未保存', error.message));
  });
  await win.loadURL('app://ui/index.html');
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(async () => {
    library = await new Library(dataRoot, { thumbnailer }).init(process.env.EAGLE_OPEN_NO_SOURCE ? null : (process.env.EAGLE_OPEN_SOURCE || null));
    protocol.handle('app', async request => {
      try {
        const url = new URL(request.url);
        if (url.host !== 'ui') return new Response('Not found',{ status: 404 });
        const file = await safeFile(__dirname, path.join(__dirname, decodeURIComponent(url.pathname)));
        if (!['.html','.css','.js'].includes(path.extname(file))) return new Response('Forbidden',{ status: 403 });
        return net.fetch(pathToFileURL(file).href);
      } catch { return new Response('Not found',{ status: 404 }); }
    });
    protocol.handle('asset', async request => {
      try {
        const url = new URL(request.url), parts = url.pathname.split('/').filter(Boolean);
        if (url.host !== 'media' || parts.length !== 2) return new Response('Not found',{status:404,headers:{'Access-Control-Allow-Origin':'app://ui'}});
        const file = await library.assetPath(decodeURIComponent(parts[0]),parts[1]);
        return mediaResponse(file, request);
      } catch { return new Response('素材文件已移动或不可用',{status:404,headers:{'Access-Control-Allow-Origin':'app://ui'}}); }
    });
    registerIPC();
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Eagle 开源', submenu: [{ role: 'about' },{ type: 'separator' },{ role: 'hide' },{ role: 'hideOthers' },{ type:'separator' },{ role:'quit' }] },
      { label: '文件', submenu: [{label:'导入素材…', accelerator:'CmdOrCtrl+I', click:()=>win?.webContents.send('menu-action','import')},{label:'新建文件夹…',accelerator:'CmdOrCtrl+Shift+N',click:()=>win?.webContents.send('menu-action','folder')},{type:'separator'},{label:'刷新原库',accelerator:'CmdOrCtrl+R',click:()=>win?.webContents.send('menu-action','refresh')},{role:'close'}] },
      { label: '编辑', submenu: [{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}] },
      { label: '显示', submenu: [{label:'搜索',accelerator:'CmdOrCtrl+F',click:()=>win?.webContents.send('menu-action','search')},{role:'togglefullscreen'}] },
      { label:'窗口',submenu:[{role:'minimize'},{role:'zoom'},{role:'front'}] },
    ]));
    app.setAboutPanelOptions({ applicationName:'Eagle 开源', applicationVersion:'0.1.0', copyright:'独立素材客户端 · Electron / Fuse.js / TagSpaces MIT modules / Lucide' });
    await createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  }).catch(error => { dialog.showErrorBox('Eagle 开源启动失败', error.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
}
