const {BrowserWindow,screen,globalShortcut}=require('electron');
const {spawn}=require('node:child_process');
const path=require('node:path');
const readline=require('node:readline');

function createCollector({mainWindow,folder,autoEnabled,onError}){
  const window=new BrowserWindow({width:296,height:296,show:false,frame:false,resizable:false,transparent:true,hasShadow:true,alwaysOnTop:true,skipTaskbar:true,focusable:true,acceptFirstMouse:true,type:'panel',
    webPreferences:{preload:path.join(__dirname,'collector-preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false}});
  window.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true,skipTransformProcessType:true});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());
  let ready=false,mode='auto',busy=false,over=false,editing=false,dragging=false,suppressed=false,timer,watcher,shortcut='',accelerator='',autoAvailable=false;
  const info=()=>({folderId:folder().id,folderName:folder().name,folders:folder().folders,shortcut,autoAvailable,autoEnabled:autoEnabled()});
  const update=()=>{if(ready&&!window.isDestroyed())window.webContents.send('collector-state',info());};
  const hide=()=>{clearTimeout(timer);if(!window.isDestroyed())window.hide();over=false;};
  const show=(reason='manual')=>{
    if(!ready||window.isDestroyed())return;
    clearTimeout(timer);if(!editing)mode=reason;const area=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    window.setPosition(area.x+area.width-312,Math.round(area.y+(area.height-window.getBounds().height)/2));window.webContents.send('collector-state',{...info(),reset:!busy});window.showInactive();
  };
  const later=ms=>{clearTimeout(timer);timer=setTimeout(()=>{if(!busy&&!over&&!editing&&mode==='auto')hide();},ms);};
  const drag=value=>{
    dragging=value.active;
    if(!value.active){suppressed=false;if(mode==='auto')later(700);return;}
    if(!suppressed&&autoEnabled()&&value.ownerPID!==process.pid&&!mainWindow()?.isFocused())show('auto');
  };
  window.loadURL('app://ui/collector.html').then(()=>{ready=true;update();});
  for(const key of ['Control+Alt+E','Control+Alt+Shift+E']){
    if(globalShortcut.register(key,()=>{if(window.isVisible())hide();else show('manual');})){accelerator=key;shortcut=key==='Control+Alt+E'?'⌃⌥E':'⌃⌥⇧E';break;}
  }
  if(process.platform==='darwin'){
    watcher=spawn(path.join(__dirname,'../assets/drag-watch'),[],{stdio:['pipe','pipe','pipe']});
    const lines=readline.createInterface({input:watcher.stdout});
    lines.on('line',line=>{try{const value=JSON.parse(line);if(typeof value.active==='boolean'){autoAvailable=true;update();drag(value);}}catch{}});
    watcher.on('error',error=>{autoAvailable=false;update();onError(error.message);});
    watcher.on('exit',()=>{autoAvailable=false;update();});watcher.stderr.resume();
  }
  return {window,show,hide,info,update,drag,
    hold(){mode='manual';clearTimeout(timer);},
    hover(value){over=!!value;if(over)clearTimeout(timer);else if(mode==='auto')later(700);},
    working(value,failed=false){busy=!!value;if(!busy&&mode==='auto')later(failed?12000:1800);},
    editing(value){editing=!!value;clearTimeout(timer);if(editing)mode='manual';window.setSize(296,editing?434:296);if(editing)window.focus();},
    dismiss(){suppressed=dragging;hide();},
    dispose(){clearTimeout(timer);if(accelerator)globalShortcut.unregister(accelerator);watcher?.kill();},
  };
}
module.exports={createCollector};
