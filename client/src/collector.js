const api=window.collector,$=selector=>document.querySelector(selector);
let state={folderId:null},queue=Promise.resolve(),pending=0;
const update=value=>{state=value;$('#destination').textContent='收藏到：'+value.folderName;$('#shortcut').textContent=value.shortcut?`${value.shortcut} 唤出 / 收起`:'从「显示」菜单唤出';if(value.reset&&!pending)message('把素材拖到这里','图片 · 音乐 · 文件');};
api.state().then(update);api.onState(update);
const message=(title,hint,error=false)=>{$('#status').textContent=title;$('#hint').textContent=hint;document.body.classList.toggle('error',error);};
api.onProgress(value=>message('正在收集…',value.phase==='download'&&value.totalBytes?`${Math.round(value.bytes/value.totalBytes*100)}%`:`已处理 ${value.completed||0} / ${value.total||1}`));
document.addEventListener('dragover',event=>{event.preventDefault();event.dataTransfer.dropEffect='copy';document.body.classList.add('over');api.hover(true);});
document.addEventListener('dragleave',event=>{if(!event.relatedTarget){document.body.classList.remove('over');api.hover(false);}});
document.addEventListener('drop',event=>{
  event.preventDefault();document.body.classList.remove('over');api.hover(false);
  const job=window.mediaDropJob(event.dataTransfer,api,state.folderId);
  if(!job){message('未识别到媒体','请拖图片本身、音乐文件链接或本地文件',true);return;}
  pending++;api.working(true);message(pending>1?'已加入收集队列':'正在收集…','完成后自动保存');
  queue=queue.then(async()=>{
    let failed=false;
    try{const result=await job();failed=!!result.skipped.length;message(failed?'部分素材未能收集':`已收集 ${result.imported.length} 份素材`,result.skipped.map(x=>x.reason).join('；')||(result.duplicates.length?`${result.duplicates.length} 份重复已略过`:'已保存到素材库'),failed);}
    catch(error){failed=true;message('收集失败',error.message,true);}
    finally{pending--;if(!pending)await api.working(false,failed);}
  });
});
$('#close').onclick=()=>api.close();$('#open-main').onclick=()=>api.openMain();
window.flushPendingEdits=()=>queue;
