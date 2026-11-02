const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('eagleOpen', {
  summary: () => ipcRenderer.invoke('summary'), query: args => ipcRenderer.invoke('query',args),
  item: id => ipcRenderer.invoke('item',id), edit: (ids,patch) => ipcRenderer.invoke('edit',ids,patch),
  createFolder: (name,parent) => ipcRenderer.invoke('create-folder',name,parent),
  editFolder: (id,name,parent) => ipcRenderer.invoke('edit-folder',id,name,parent),
  createSmartFolder: (name,criteria) => ipcRenderer.invoke('smart-folder',name,criteria),
  recordOpen: id => ipcRenderer.invoke('record-open',id), exportFiles: ids => ipcRenderer.invoke('export-files',ids),
  preferences: values => ipcRenderer.invoke('preferences',values), refresh: () => ipcRenderer.invoke('refresh'),
  connectSource: () => ipcRenderer.invoke('connect-source'),
  chooseImport: (type,folder) => ipcRenderer.invoke('choose-import',type,folder),
  dropImport: (paths,folder) => ipcRenderer.invoke('drop-import',paths,folder), filePath: file => webUtils.getPathForFile(file),
  captureMedia: (items,folder) => ipcRenderer.invoke('capture-media',items,folder), openURL: url => ipcRenderer.invoke('open-url',url),
  reveal: id => ipcRenderer.invoke('reveal',id), openFile: id => ipcRenderer.invoke('open-file',id),
  onProgress: fn => ipcRenderer.on('import-progress',(_e,data) => fn(data)),
  onMenu: fn => ipcRenderer.on('menu-action',(_e,action) => fn(action)),
});
