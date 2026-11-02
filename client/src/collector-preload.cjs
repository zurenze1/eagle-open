const {contextBridge,ipcRenderer,webUtils}=require('electron');
contextBridge.exposeInMainWorld('collector',{
  state:()=>ipcRenderer.invoke('collector-state'),close:()=>ipcRenderer.invoke('collector-close'),openMain:()=>ipcRenderer.invoke('collector-main'),
  hover:value=>ipcRenderer.invoke('collector-hover',value),working:(value,failed)=>ipcRenderer.invoke('collector-working',value,failed),
  editing:value=>ipcRenderer.invoke('collector-editing',value),setFolder:id=>ipcRenderer.invoke('collector-folder',id),createFolder:(name,parent)=>ipcRenderer.invoke('create-folder',name,parent),
  hold:()=>ipcRenderer.invoke('collector-hold'),assignFolder:(ids,folder)=>ipcRenderer.invoke('collector-assign',ids,folder),
  dropImport:(paths,folder,source)=>ipcRenderer.invoke('drop-import',paths,folder,source),
  importBytes:(input,folder)=>ipcRenderer.invoke('import-bytes',input,folder),captureMedia:(items,folder)=>ipcRenderer.invoke('capture-media',items,folder),
  filePath:file=>webUtils.getPathForFile(file),
  onState:fn=>ipcRenderer.on('collector-state',(_e,value)=>fn(value)),onProgress:fn=>ipcRenderer.on('import-progress',(_e,value)=>fn(value)),
});
