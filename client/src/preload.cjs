const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('eagleOpen', {
  summary: () => ipcRenderer.invoke('summary'), query: args => ipcRenderer.invoke('query',args),
  item: id => ipcRenderer.invoke('item',id), edit: (ids,patch) => ipcRenderer.invoke('edit',ids,patch),
  createFolder: (name,parent) => ipcRenderer.invoke('create-folder',name,parent),
  preferences: values => ipcRenderer.invoke('preferences',values), refresh: () => ipcRenderer.invoke('refresh'),
  connectSource: () => ipcRenderer.invoke('connect-source'),
  chooseImport: (type,folder) => ipcRenderer.invoke('choose-import',type,folder),
  dropImport: (paths,folder) => ipcRenderer.invoke('drop-import',paths,folder), filePath: file => webUtils.getPathForFile(file),
  reveal: id => ipcRenderer.invoke('reveal',id), openFile: id => ipcRenderer.invoke('open-file',id),
  onProgress: fn => ipcRenderer.on('import-progress',(_e,data) => fn(data)),
  onMenu: fn => ipcRenderer.on('menu-action',(_e,action) => fn(action)),
});
