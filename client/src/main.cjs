const { app, BrowserWindow, ipcMain, dialog, protocol, net, nativeImage, shell, Menu, screen } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Library, safeFile, inside } = require('./library.cjs');
const { mediaResponse } = require('./media.cjs');
const { captureMedia, importMediaBytes, sourceMetadata, webURL } = require('./capture.cjs');
const { createCollector } = require('./collector.cjs');
const run = promisify(execFile);
app.setName('Eagle 开源');
const projectRoot = app.isPackaged ? require('../workspace.json').projectRoot : path.resolve(__dirname, '../..');
const dataRoot = process.env.EAGLE_OPEN_DATA || path.join(projectRoot, 'data');
app.setPath('userData', path.join(dataRoot, 'runtime'));
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'asset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);
let win, library, collector, collectorFolder=null, quitting=false,quitPending=false;
const collectorItems=new Set();
const send=(name,value)=>{for(const window of [win,collector?.window])if(window&&!window.isDestroyed())window.webContents.send(name,value);};
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
    const main=event.sender===win?.webContents&&event.senderFrame?.url==='app://ui/index.html';
    const panel=event.sender===collector?.window.webContents&&event.senderFrame?.url==='app://ui/collector.html';
    const panelAllowed=['collector-state','collector-close','collector-main','collector-hover','collector-working','collector-folder','collector-editing','collector-hold','collector-complete','collector-assign','collector-edit','create-folder','drop-import','import-bytes','capture-media'];
    if(!main&&!(panel&&panelAllowed.includes(name)))throw new Error('拒绝不可信页面调用');
    const result=await fn(...args);
    if(panel&&['drop-import','import-bytes','capture-media'].includes(name)){result.duplicates=result.duplicates.map(item=>library.publicItem(library.get(item.id)));for(const item of [...result.imported,...result.duplicates])collectorItems.add(item.id);}
    while(collectorItems.size>1000)collectorItems.delete(collectorItems.values().next().value);
    if(panel&&['drop-import','import-bytes','capture-media','create-folder','collector-assign','collector-edit'].includes(name)&&win&&!win.isDestroyed())win.webContents.send('library-changed');
    return result;
  });
  handle('summary', () => library.summary());
  handle('query', args => {if(!collector?.window.isVisible())collectorFolder=args?.folderId||null;collector?.update();return library.query(args);});
  handle('item', id => library.publicItem(library.get(id)));
  handle('edit', (ids, patch) => library.edit(ids, patch));
  handle('create-folder', (name,parent) => library.createFolder(name,parent));
  handle('edit-folder', (id,name,parent) => library.editFolder(id,name,parent));
  handle('smart-folder', (name,criteria) => library.createSmartFolder(name,criteria));
  handle('record-open', id => library.recordOpen(id));
  handle('export-files', async ids => {
    if (!Array.isArray(ids) || !ids.length || ids.length > 2000) throw new Error('请选择要导出的素材');
    const result = await dialog.showOpenDialog(win, { title: '导出原文件到', properties: ['openDirectory','createDirectory'] });
    if (result.canceled) return null;
    const destination = await fs.realpath(result.filePaths[0]);
    if (inside(library.root,destination) || library.state.sources.some(s=>inside(s.path,destination))) throw new Error('请选择素材库之外的导出目录，保留素材库原件');
    let count = 0;
    for (const id of ids) {
      const item = library.get(id), source = await library.assetPath(id,'original');
      const name = item.name.replace(/[\x00-\x1f/\\:*?"<>|]/g,'_').slice(0,150) || '素材';
      let index = 0;
      for (;;) {
        const target = path.join(destination, name + (index ? ` (${index})` : '') + (item.ext ? '.' + item.ext : ''));
        try { await fs.copyFile(source,target,1); break; } catch (error) { if (error.code !== 'EEXIST') throw error; index++; }
      }
      count++;
    }
    return { count };
  });
  handle('preferences', values => library.savePreferences(values));
  handle('refresh', () => library.refresh());
  handle('connect-source', async () => {
    const result = await dialog.showOpenDialog(win, { title: '选择 Eagle 原素材库（只读接入）', properties: ['openDirectory','treatPackageAsDirectory'], buttonLabel: '只读接入' });
    if (!result.canceled) return library.connectSource(result.filePaths[0]);
    return null;
  });
  const importFiles = async (paths, folder, source) => {
    const metadata={};
    if(source&&Array.isArray(paths)&&paths.length===1)metadata[await fs.realpath(paths[0])]=sourceMetadata(source);
    return library.importPaths(paths, folder, progress => send('import-progress',progress),metadata);
  };
  handle('choose-import', async (type, folder) => {
    const result = await dialog.showOpenDialog(win, { title: type === 'folder' ? '导入文件夹，保留层级' : '导入素材', properties: type === 'folder' ? ['openDirectory'] : ['openFile','multiSelections'] });
    return result.canceled ? null : importFiles(result.filePaths, folder);
  });
  handle('drop-import', (paths,folder,source) => importFiles(paths,folder,source));
  handle('import-bytes', (input,folder) => importMediaBytes(library,input,folder));
  handle('capture-media', (items,folder) => captureMedia(library,items,folder,progress => send('import-progress',progress)));
  handle('collector-state',()=>collector.info());
  handle('collector-close',()=>collector.dismiss());
  handle('collector-hover',value=>collector.hover(value));
  handle('collector-working',(value,failed)=>collector.working(value,failed));
  handle('collector-editing',value=>collector.editing(value));
  handle('collector-hold',()=>collector.hold());
  const checkCollected=ids=>{if(!Array.isArray(ids)||!ids.length||ids.length>1000||ids.some(id=>!collectorItems.has(id)))throw new Error('此入口仅整理本次收集的素材');};
  handle('collector-assign',async(ids,folder)=>{checkCollected(ids);if(folder===null)return;if(!library.folders().some(f=>f.id===folder))throw new Error('文件夹已不存在');for(const id of ids){const item=library.get(id);await library.edit([id],{folders:[...new Set([...item.folders,folder])]});}const recent=[folder,...(library.state.preferences.collectorRecent||[]).filter(id=>id!==folder)].slice(0,5);await library.savePreferences({collectorRecent:recent});collector.update();});
  handle('collector-edit',(ids,patch)=>{checkCollected(ids);return library.edit(ids,Object.fromEntries(['name','annotation','tags','rating'].filter(key=>Object.hasOwn(patch,key)).map(key=>[key,patch[key]])));});
  handle('collector-complete',()=>collector.complete());
  handle('collector-folder',id=>{if(id!==null&&!library.folders().some(f=>f.id===id))throw new Error('文件夹已不存在，请重新选择');collectorFolder=id;collector.update();return id;});
  handle('collector-main',()=>{collector.hide();if(win.isMinimized())win.restore();win.show();win.focus();});
  handle('open-url', url => shell.openExternal(webURL(url)));
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
  window.on('close', event => {
    if (quitting) return;
    event.preventDefault();
    // Red close hides the library; the explicitly requested quick collector stays available.
    window.webContents.executeJavaScript('window.flushPendingEdits ? window.flushPendingEdits() : Promise.resolve()')
      .then(() => window.hide())
      .catch(error => dialog.showErrorBox('更改尚未保存', error.message));
  });
  await win.loadURL('app://ui/index.html');
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('before-quit',event=>{
    if(quitting)return;event.preventDefault();if(quitPending)return;quitPending=true;
    Promise.all([win,collector?.window].filter(w=>w&&!w.isDestroyed()).map(w=>w.webContents.executeJavaScript('window.flushPendingEdits ? window.flushPendingEdits() : Promise.resolve()')))
      .then(()=>library?.queue)
      .then(()=>{quitting=true;collector?.dispose();app.quit();})
      .catch(error=>{quitPending=false;dialog.showErrorBox('更改尚未保存',error.message);});
  });
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
      { label: '显示', submenu: [{label:'搜索',accelerator:'CmdOrCtrl+F',click:()=>win?.webContents.send('menu-action','search')},{label:'快捷收集框',click:()=>collector?.show()},{label:'拖拽时自动显示收集框',type:'checkbox',checked:library.state.preferences.collectorAuto!==false,click:item=>library.savePreferences({collectorAuto:item.checked}).then(()=>collector?.update())},{role:'togglefullscreen'}] },
      { label:'窗口',submenu:[{role:'minimize'},{role:'zoom'},{role:'front'}] },
    ]));
    app.setAboutPanelOptions({ applicationName:'Eagle 开源', applicationVersion:app.getVersion(), copyright:'独立素材客户端 · Electron / Fuse.js / TagSpaces MIT modules / Lucide' });
    await createWindow();
    collector=createCollector({mainWindow:()=>win,folder:()=>({id:collectorFolder,name:library.folders().find(f=>f.id===collectorFolder)?.name||'素材库',folders:library.folders(),recent:library.state.preferences.collectorRecent||[]}),autoEnabled:()=>library.state.preferences.collectorAuto!==false,onError:message=>console.error('自动收集框不可用：'+message)});
    app.on('activate', () => { if(win&&!win.isDestroyed()){win.show();win.focus();}else createWindow(); });
  }).catch(error => { dialog.showErrorBox('Eagle 开源启动失败', error.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
}
