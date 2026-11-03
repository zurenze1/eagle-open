// Snapshot protected drag data synchronously, then import it through a supplied bridge.
(()=>{
  window.mediaDropJob=(transfer,api,folder)=>{
    if(transfer.getData('application/x-eagle-open-items'))return null;
    const paths=[],virtual=[];
    for(const file of transfer.files){let nativePath='';try{nativePath=api.filePath(file);}catch{}if(nativePath)paths.push(nativePath);else if(file.size)virtual.push(file);}
    const media=window.readMediaDrop(transfer);
    // Browsers may provide a video URL together with an image File of its poster.
    const posterFiles=transfer.files.length&&[...transfer.files].every(file=>/^image\//i.test(file.type)||/\.(?:avif|gif|jpe?g|png|webp)$/i.test(file.name));
    if(media.some(item=>item.resolvePage)||(posterFiles&&media.length===1&&media[0].expectedKind==='video')){paths.length=0;virtual.length=0;}
    if(!paths.length&&!virtual.length&&!media.length)return null;
    return async()=>{
      const result={imported:[],duplicates:[],skipped:[]},merge=saved=>{for(const key of ['imported','duplicates','skipped'])result[key].push(...saved[key]);};
      const source=media.length===1?media[0]:undefined;
      if(paths.length)merge(await api.dropImport(paths,folder,paths.length===1?source:undefined));
      for(const file of virtual){
        try{if(file.size>32*1024*1024)throw new Error('浏览器临时素材超过 32 MB，请拖下载直链或先保存文件');const bytes=new Uint8Array(await file.arrayBuffer()),metadata=virtual.length===1?source:{};merge(await api.importBytes({...metadata,bytes,name:metadata?.name||file.name},folder));}
        catch(error){result.skipped.push({name:file.name,reason:error.message});}
      }
      if(!paths.length&&!virtual.length)merge(await api.captureMedia(media,folder));return result;
    };
  };
})();
