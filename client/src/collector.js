const api=window.collector,$=selector=>document.querySelector(selector);
let state={folderId:null},queue=Promise.resolve(),pending=0,collected=[];
const options=(select,selected)=>{select.replaceChildren();const root=new Option('素材库根目录','');select.add(root);const visit=(parent,depth)=>{for(const f of (state.folders||[]).filter(f=>f.parentId===parent)){select.add(new Option('　'.repeat(Math.min(depth,6))+f.name,f.id));visit(f.id,depth+1);}};visit(null,0);select.value=selected||'';};
const update=value=>{state=value;$('#destination').textContent='收藏到：'+value.folderName;options($('#folder-select'),value.folderId);$('#shortcut').textContent=value.shortcut?`${value.shortcut} 唤出 / 收起`:'从「显示」菜单唤出';if(value.reset&&!pending){collected=[];message('把素材拖到这里','图片 · 音乐 · 文件');}};
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
    try{const result=await job();collected=[...new Set([...result.imported,...result.duplicates].map(i=>i.id))];if(collected.length&&state.folderId)await api.assignFolder(collected,state.folderId);failed=!!result.skipped.length;message(failed?'未能收集部分素材':result.imported.length?`已收集 ${result.imported.length} 份素材`:'素材已在库中',result.skipped.map(x=>x.reason).join('；')||(result.duplicates.length?`${result.duplicates.length} 份重复已略过`:'已保存到素材库'),failed);}
    catch(error){failed=true;message('收集失败',error.message,true);}
    finally{pending--;if(!pending)await api.working(false,failed);}
  });
});
$('#close').onclick=()=>api.close();$('#open-main').onclick=()=>api.openMain();
const editing=async value=>{$('#folder-form').hidden=!value;document.body.classList.toggle('editing',value);await api.editing(value);if(value)$('#folder-name').focus();};
const selectFolder=async id=>{await api.setFolder(id);if(id&&collected.length){await api.assignFolder(collected,id);message('已加入文件夹','当前素材已保存到所选分类');}};
$('#folder-select').onpointerdown=()=>api.hold();
$('#folder-select').onchange=()=>selectFolder($('#folder-select').value||null).catch(e=>message('无法选择分类',e.message,true));
$('#new-folder').onclick=()=>{$('#folder-name').value='';options($('#folder-parent'),state.folderId);editing(true);};
$('#folder-cancel').onclick=()=>editing(false);
$('#folder-form').onsubmit=async event=>{event.preventDefault();try{const folder=await api.createFolder($('#folder-name').value,$('#folder-parent').value||null);await selectFolder(folder.id);await editing(false);message('文件夹已创建',collected.length?'当前素材已加入新文件夹':'拖入素材即可保存到这里');}catch(error){message('创建失败',error.message,true);}};
window.flushPendingEdits=()=>queue;
