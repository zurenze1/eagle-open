const api=window.collector,$=s=>document.querySelector(s);
let state={folderId:null,folders:[],recent:[]},queue=Promise.resolve(),pending=0,batch=null,current=null,dirty=false,selected=new Set(),initialized=false;
const expanded=new Set();
const message=(title,hint,error=false)=>{$('#status').textContent=title;$('#hint').textContent=hint;document.body.classList.toggle('error',error);};
const enqueue=fn=>{queue=queue.catch(()=>{}).then(fn);return queue;};
const takeEdit=()=>{
  if(!dirty||!current)return null;
  const item=current,patch={name:$('#item-name').value,annotation:$('#item-note').value,tags:$('#item-tags').value.split(/[,，\n]/).map(t=>t.trim()).filter(Boolean),rating:Number($('#rating').dataset.value)||0};dirty=false;
  return async()=>{try{const [saved]=await api.editCurrent([item.id],patch);Object.assign(item,saved);}catch(e){if(current===item)dirty=true;message('修改未保存',e.message,true);throw e;}};
};
const flush=async()=>{const edit=takeEdit();if(edit)enqueue(edit);await queue;};
const queueEdit=()=>{const edit=takeEdit();if(edit)enqueue(edit).catch(()=>{});};
const folderName=id=>state.folders.find(f=>f.id===id)?.name||'素材库根目录';
const folderIcon='<svg viewBox="0 0 24 21" aria-hidden="true"><path d="M2 6V3h7l3 3h10v13H2z"/></svg>';
const renderFolders=()=>{
  const list=$('#folder-list'),query=$('#folder-search').value.trim().toLocaleLowerCase();list.replaceChildren();
  const row=(folder,depth=0,recent=false)=>{
    const button=document.createElement('button');button.type='button';button.className='folder-row';button.dataset.folder=folder.id||'';button.setAttribute('role','treeitem');button.setAttribute('aria-selected',String(selected.has(folder.id)));button.classList.toggle('selected',selected.has(folder.id));button.title=folder.name;button.style.paddingLeft=(9+Math.min(depth,7)*15)+'px';button.innerHTML=folderIcon;
    const text=document.createElement('span');text.className='label';text.textContent=folder.name;button.append(text);
    const children=state.folders.some(f=>f.parentId===folder.id);
    if(children&&!recent&&folder.id){const arrow=document.createElement('span');arrow.className='chevron';arrow.textContent=expanded.has(folder.id)||query?'⌄':'›';arrow.onclick=e=>{e.stopPropagation();expanded.has(folder.id)?expanded.delete(folder.id):expanded.add(folder.id);renderFolders();};button.append(arrow);button.setAttribute('aria-expanded',String(expanded.has(folder.id)));}
    button.onclick=event=>{
      if(event.metaKey){if(folder.id===null)selected.clear();else selected.delete(null);selected.has(folder.id)?selected.delete(folder.id):selected.add(folder.id);renderFolders();$('#save-selection').hidden=!batch||!selected.size;api.hold();return;}
      selected=new Set([folder.id]);renderFolders();if(batch)commit().catch(e=>message('分类未保存',e.message,true));else api.setFolder(folder.id);
    };
    list.append(button);
  };
  if(!query){const recent=[...new Set([...state.recent,...(state.folderId?[state.folderId]:[])])].map(id=>state.folders.find(f=>f.id===id)).filter(Boolean).slice(0,5);if(recent.length){const label=document.createElement('div');label.className='recent-heading';label.textContent='最近收藏';list.append(label);for(const f of recent)row(f,0,true);const line=document.createElement('div');line.className='folder-divider';list.append(line);}row({id:null,name:'全部 / 素材库根目录'});}
  const visit=(parent,depth)=>{for(const f of state.folders.filter(f=>f.parentId===parent)){const matches=f.name.toLocaleLowerCase().includes(query);if(!query||matches)row(f,query?0:depth);if(query||expanded.has(f.id))visit(f.id,depth+1);}};visit(null,0);
  if(!list.children.length){const empty=document.createElement('div');empty.className='recent-heading';empty.textContent='没有匹配的文件夹';list.append(empty);}
};
const reset=()=>{batch=null;current=null;dirty=false;selected=new Set(state.folderId?[state.folderId]:[]);document.body.classList.remove('received');$('#metadata').hidden=true;$('#preview').hidden=true;$('#preview').replaceChildren();$('#empty-preview').hidden=false;$('#thumbnails').hidden=true;$('#media-info').textContent='';$('#save-selection').hidden=true;$('#folder-search').value='';message('把素材拖到这里','图片 · 视频 · 音乐 · 文件');};
const update=value=>{state=value;if(!initialized){selected=new Set(value.folderId?[value.folderId]:[]);initialized=true;}$('#destination').textContent='收藏到：'+value.folderName;$('#shortcut').textContent=value.shortcut?`${value.shortcut} 唤出 / 收起`:'从「显示」菜单唤出';if(value.reset&&!pending&&!dirty)reset();renderFolders();};
api.state().then(update);api.onState(update);
api.onHidden(()=>document.querySelectorAll('#preview video,#preview audio').forEach(media=>media.pause()));
api.onProgress(value=>{if(pending)message('正在收集…',value.phase==='download'&&value.totalBytes?`${Math.round(value.bytes/value.totalBytes*100)}%`:`已处理 ${value.completed||0} / ${value.total||1}`);});
const renderItem=item=>{
  current=item;dirty=false;document.body.classList.add('received');$('#empty-preview').hidden=true;$('#preview').hidden=false;$('#metadata').hidden=false;
  const media=document.createElement(item.kind==='video'?'video':item.kind==='audio'?'audio':'img');if(['video','audio'].includes(item.kind)){media.controls=true;media.preload='metadata';if(item.kind==='video'){media.muted=true;media.autoplay=true;media.loop=true;}media.src=item.mediaURL;}else if(item.thumbURL)media.src=item.thumbURL;else media.alt=item.ext?.toUpperCase()||'文件';$('#preview').replaceChildren(media);
  $('#media-info').textContent=[item.ext?.toUpperCase(),item.kind==='video'?'视频':item.kind==='audio'?'音频':null,item.duration?`${Number(item.duration).toFixed(1)} 秒`:null].filter(Boolean).join(' · ');
  $('#item-name').value=item.name;$('#item-note').value=item.annotation||'';$('#item-tags').value=(item.tags||[]).join('，');$('#source').textContent=item.url||'';$('#source').title=item.url||'';
  $('#rating').dataset.value=item.rating||0;$('#rating').replaceChildren();for(let i=1;i<=5;i++){const star=document.createElement('button');star.type='button';star.textContent='★';star.setAttribute('aria-label',i+' 星');star.classList.toggle('on',i<=(item.rating||0));star.onclick=()=>{const rating=Number($('#rating').dataset.value)===i?0:i;$('#rating').dataset.value=rating;[...$('#rating').children].forEach((s,index)=>s.classList.toggle('on',index<rating));dirty=true;queueEdit();};$('#rating').append(star);}
  for(const button of $('#thumbnails').children)button.classList.toggle('selected',button.dataset.id===item.id);
};
const renderBatch=value=>{
  const strip=$('#thumbnails');strip.replaceChildren();strip.hidden=value.items.length<2;
  for(const item of value.items){const button=document.createElement('button');button.type='button';button.dataset.id=item.id;const kind=({video:'视频',audio:'音频',image:'图片',font:'字体'})[item.kind]||'文件';button.title=item.name+' · '+kind;button.setAttribute('aria-label',button.title);if(item.thumbURL){const image=document.createElement('img');image.src=item.thumbURL;button.append(image);}else button.textContent=item.ext?.toUpperCase()||'文件';if(item.kind==='video'||item.kind==='audio'){const badge=document.createElement('span');badge.className='media-badge';badge.textContent=item.kind==='video'?'▶':'♫';button.append(badge);}button.onclick=()=>{queueEdit();renderItem(item);};strip.append(button);}
  if(value.items[0])renderItem(value.items[0]);
};
const commit=async()=>{
  const value=batch,folders=[...selected];if(!value||!folders.length)return;
  value.chosen=folders;await api.hold();if(!value.items){message('正在收集…','完成后加入 '+folders.map(folderName).join('、'));return;}
  await flush();for(const id of folders)await api.assignFolder(value.items.map(i=>i.id),id);await api.setFolder(folders[0]);message('已保存分类',folders.map(folderName).join('、'));$('#save-selection').hidden=true;await api.complete();
};
let expandTimer;
document.addEventListener('dragover',event=>{
  event.preventDefault();event.dataTransfer.dropEffect='copy';api.hover(true);const target=event.target.closest('.folder-row');
  for(const row of document.querySelectorAll('.drop-over'))if(row!==target)row.classList.remove('drop-over');document.body.classList.toggle('over',!target);
  if(target){target.classList.add('drop-over');const id=target.dataset.folder;if(id&&!expanded.has(id)&&!expandTimer)expandTimer=setTimeout(()=>{expanded.add(id);expandTimer=null;renderFolders();},700);}
});
document.addEventListener('dragleave',event=>{if(!event.relatedTarget){document.body.classList.remove('over');document.querySelectorAll('.drop-over').forEach(el=>el.classList.remove('drop-over'));clearTimeout(expandTimer);expandTimer=null;api.hover(false);}});
document.addEventListener('drop',event=>{
  event.preventDefault();clearTimeout(expandTimer);expandTimer=null;const row=event.target.closest('.folder-row'),folder=row?(row.dataset.folder||null):null;
  const job=window.mediaDropJob(event.dataTransfer,api,folder);document.body.classList.remove('over');document.querySelectorAll('.drop-over').forEach(el=>el.classList.remove('drop-over'));api.hover(false);
  if(!job){message('未识别到媒体','请拖图片本身、音视频链接或本地文件',true);return;}
  queueEdit();const value={items:null,chosen:row?[folder]:null};batch=value;current=null;dirty=false;selected=new Set(value.chosen||[]);renderFolders();$('#metadata').hidden=true;$('#thumbnails').hidden=true;$('#preview').hidden=true;$('#preview').replaceChildren();$('#empty-preview').hidden=false;$('#media-info').textContent='';pending++;api.working(true);if(!row)api.hold();message('正在收集…',row?'直接保存到 '+folderName(folder):'放下后可选择右侧文件夹');
  enqueue(async()=>{
    let failed=false;
    try{
      const result=await job();value.items=[...new Map([...result.imported,...result.duplicates].map(i=>[i.id,i])).values()];
      if(value.chosen&&value.items.length){for(const id of value.chosen)await api.assignFolder(value.items.map(i=>i.id),id);await api.setFolder(value.chosen[0]);}
      failed=!!result.skipped.length;
      if(batch===value){renderBatch(value);message(failed?'未能收集部分素材':result.imported.length?`已收集 ${result.imported.length} 份素材`:'素材已在库中',result.skipped.map(i=>i.reason).join('；')||(value.chosen?'已保存到 '+value.chosen.map(folderName).join('、'):'请选择右侧文件夹，可先修改名称、注释和标签')+(result.duplicates.length?`；${result.duplicates.length} 份重复已略过`:''),failed);$('#save-selection').hidden=!value.items.length||!selected.size;if(value.chosen&&!failed)await api.complete();}
    }catch(error){failed=true;message('收集失败',error.message,true);}
    finally{pending--;if(!pending)await api.working(false,failed);}
  }).catch(()=>{});
});
for(const field of ['#item-name','#item-note','#item-tags']){$(field).oninput=()=>{dirty=true;};$(field).onchange=queueEdit;$(field).onfocus=()=>api.editing(true);}
$('#folder-search').oninput=()=>{renderFolders();api.hold();};$('#folder-search').onfocus=()=>api.editing(true);
$('#close').onclick=async()=>{try{await flush();await api.close();}catch{}};$('#open-main').onclick=async()=>{try{await flush();await api.openMain();}catch{}};
$('#save-selection').onclick=()=>commit().catch(e=>message('分类未保存',e.message,true));
const editing=async value=>{$('#folder-form').hidden=!value;document.body.classList.toggle('editing',value);await api.editing(value);if(value)$('#folder-name').focus();};
$('#new-folder').onclick=()=>{const select=$('#folder-parent');select.replaceChildren(new Option('素材库根目录',''));for(const folder of state.folders)select.add(new Option(folder.name,folder.id));select.value=[...selected][0]||state.folderId||'';$('#folder-name').value='';editing(true);};
$('#folder-cancel').onclick=()=>editing(false);
$('#folder-form').onsubmit=async event=>{event.preventDefault();try{const folder=await api.createFolder($('#folder-name').value,$('#folder-parent').value||null);await api.setFolder(folder.id);state=await api.state();expanded.add(folder.parentId);selected=new Set([folder.id]);renderFolders();await editing(false);if(batch)await commit();else message('文件夹已创建','拖到此文件夹即可保存');}catch(error){message('创建失败',error.message,true);}};
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();if(!$('#folder-form').hidden)editing(false);else $('#close').click();return;}
  if(event.target.matches('input,textarea,select')&&!(event.target.id==='folder-search'&&['ArrowDown','ArrowUp'].includes(event.key)))return;
  const rows=[...document.querySelectorAll('.folder-row')],index=rows.indexOf(document.activeElement);
  if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();rows[Math.max(0,Math.min(rows.length-1,index+(event.key==='ArrowDown'?1:-1)))]?.focus();}
  if(event.key==='Enter'&&selected.size>1){event.preventDefault();commit().catch(e=>message('分类未保存',e.message,true));}
});
window.flushPendingEdits=flush;
