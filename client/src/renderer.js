const api = window.eagleOpen;
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => `<i data-lucide="${name}"></i>`;
const icons = () => {
  lucide.createIcons({ attrs: { 'stroke-width': 1.6 } });
  // 已生成的 SVG 不重复替换，保证双击两次命中同一节点。
  document.querySelectorAll('svg[data-lucide]').forEach(svg=>svg.removeAttribute('data-lucide'));
};
const bytes = n => n < 1024 ? n + ' B' : n < 1048576 ? (n/1024).toFixed(1)+' KB' : n < 1073741824 ? (n/1048576).toFixed(1)+' MB' : (n/1073741824).toFixed(2)+' GB';
const duration = n => n > 0 ? `${Math.floor(n/60).toString().padStart(2,'0')}:${Math.floor(n%60).toString().padStart(2,'0')}` : '';
const date = n => n ? new Date(n).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}) : '—';
const kinds = {image:'图片',video:'视频',audio:'音频',font:'字体',file:'文件'};
const state = { summary:null, view:'all', folderId:null, smartId:null, randomSeed:0, tag:null, items:[], selected:new Set(), active:null, total:0, text:'',kind:'all',sort:'newest',collapsed:new Set(),busy:false,request:0,anchor:null };
let toastTimer, searchTimer;
function toast(message, error = false, persistent = false) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').classList.toggle('error',error); $('#toast').classList.remove('hidden');
  if (!persistent) toastTimer=setTimeout(()=>$('#toast').classList.add('hidden'),4500);
}
async function attempt(fn) { try { return await fn(); } catch(e) { toast(e.message || String(e),true); } }
const selectedItems = () => state.items.filter(i => state.selected.has(i.id));
api.onLibraryChanged(()=>attempt(async()=>{await summary();await load();renderInspector();}));
const title = () => state.smartId ? state.summary.smartFolders.find(f=>f.id===state.smartId)?.name || '智能文件夹' : state.folderId ? state.summary.folders.find(f => f.id===state.folderId)?.name || '文件夹' : ({all:'全部素材',local:'我的导入',unfiled:'未分类',untagged:'未标签',recent:'最近使用',random:'随机模式',trash:'回收站',tags:'标签管理'}[state.view] || '全部素材');
async function summary() {
  state.summary = await api.summary();
  $('#library-subtitle').textContent = `${state.summary.total.toLocaleString()} 份素材 · ${state.summary.sources.length ? '已接入 Eagle' : '独立素材库'}`;
  $('#source-status').textContent = state.summary.sources.length ? '原库只读 · 编辑独立保存' : '本地保存 · 保留原文件';
  const warnings=$('#warnings'); warnings.textContent=state.summary.warnings.join(' ');warnings.classList.toggle('hidden',!state.summary.warnings.length);
  renderNavigation();renderFolders();
}
function renderNavigation() {
  const s=state.summary;
  const rows=[['all','inbox','全部素材',s.total],['local','download','我的导入',s.localCount],['unfiled','folder-open','未分类',s.unfiled],['untagged','bookmark','未标签',s.untagged],['recent','clock-3','最近使用',s.recent],['random','shuffle','随机模式',s.total],['tags','tags','标签管理',s.tags.length],['trash','trash-2','回收站',s.trash]];
  $('#navigation').innerHTML=rows.map(([view,i,label,count])=>`<button class="nav-row ${!state.folderId&&state.view===view?'active':''}" data-view="${view}">${icon(i)}<span>${label}</span><small>${count.toLocaleString()}</small></button>`).join('');
  $('#navigation').querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>attempt(()=>navigate(button.dataset.view)));
  icons();
}
function renderFolders() {
  const folders=state.summary.folders, query=$('#folder-filter').value.trim().toLowerCase();
  $('#smart-folders').innerHTML=state.summary.smartFolders.map(f=>`<button class="nav-row ${state.smartId===f.id?'active':''}" data-smart="${esc(f.id)}">${icon('folder-search')}<span>${esc(f.name)}</span><small>${f.count}</small></button>`).join('');
  $('#smart-folders').querySelectorAll('[data-smart]').forEach(button=>button.onclick=()=>attempt(async()=>{state.smartId=button.dataset.smart;state.folderId=null;state.view='smart';state.selected.clear();state.active=null;state.text='';state.kind='all';state.tag=null;$('#search').value='';$('#kind').value='all';clearAdvanced();renderNavigation();renderFolders();await load();}));
  $('#folder-total').textContent=folders.length;
  const row=(f,depth)=>{
    const children=folders.filter(c=>c.parentId===f.id), collapsed=state.collapsed.has(f.id);
    if (query) { if (!f.name.toLowerCase().includes(query)) return ''; }
    return `<div class="folder-row ${state.folderId===f.id?'active':''}" style="--depth:${Math.min(depth,5)}"><button class="folder-toggle ${!children.length||query?'invisible':''}" data-toggle="${esc(f.id)}" aria-label="${collapsed?'展开':'收起'} ${esc(f.name)}">${icon(collapsed?'chevron-right':'chevron-down')}</button><button class="folder-button" data-folder="${esc(f.id)}" title="${esc(f.name)}">${icon('folder')}<span>${esc(f.name)}</span><small>${f.count}</small></button></div>${!query&&!collapsed?children.map(c=>row(c,depth+1)).join(''):''}`;
  };
  $('#folders').innerHTML=query?folders.map(f=>row(f,0)).join(''):folders.filter(f=>!f.parentId||!folders.some(p=>p.id===f.parentId)).map(f=>row(f,0)).join('');
  $('#folders').querySelectorAll('[data-folder]').forEach(button=>{
    button.onclick=()=>attempt(()=>navigate('folder',button.dataset.folder));
    button.oncontextmenu=e=>{e.preventDefault();editFolder(button.dataset.folder);};
    button.ondragover=e=>{e.preventDefault();button.classList.add('drag-target');};
    button.ondragleave=()=>button.classList.remove('drag-target');
    button.ondrop=e=>{e.preventDefault();e.stopPropagation();button.classList.remove('drag-target');$('#drop-overlay').classList.add('hidden');dragDepth=0;const internal=e.dataTransfer.getData('application/x-eagle-open-items');if(internal){const ids=JSON.parse(internal);attempt(async()=>{for(const id of ids){const item=await api.item(id);await api.edit([id],{folders:[...new Set([...item.folders,button.dataset.folder])]});}await summary();await load();toast('已加入文件夹');});}else attempt(()=>importDrop(e,button.dataset.folder));};
  });
  $('#folders').querySelectorAll('[data-toggle]').forEach(button=>button.onclick=()=>{const id=button.dataset.toggle;state.collapsed.has(id)?state.collapsed.delete(id):state.collapsed.add(id);renderFolders();});
  icons();
}
async function navigate(view,folderId=null) {
  state.view=view;state.folderId=folderId;state.smartId=null;state.randomSeed=Date.now();state.tag=null;state.selected.clear();state.active=null;
  renderNavigation();renderFolders();await load();renderInspector();
}
async function load(more=false) {
  const req=++state.request;
  $('#view-title').textContent=title();
  $('#tag-filter').classList.toggle('hidden',!state.tag);
  $('#tag-filter').innerHTML=state.tag?`${icon('tag')}<span>${esc(state.tag)}</span><button class="icon-button" aria-label="移除标签筛选">${icon('x')}</button>`:'';
  if (state.tag) $('#tag-filter button').onclick=()=>{state.tag=null;attempt(()=>load());};
  const tagsMode=state.view==='tags';
  $('#grid-scroll').classList.toggle('hidden',tagsMode);$('#tag-browser').classList.toggle('hidden',!tagsMode);
  if (tagsMode) {
    const tags=state.summary.tags.filter(t=>!state.text||t.name.toLowerCase().includes(state.text.toLowerCase()));
    $('#tag-browser').innerHTML=`<div class="tag-heading">${tags.length} 个标签<span>选择标签，查看关联素材</span></div><div class="tag-list">${tags.map(t=>`<button class="tag-card" data-tag="${esc(t.name)}">${icon('tag')}<span>${esc(t.name)}</span><small>${t.count}</small></button>`).join('')}</div>`;
    $('#tag-browser').querySelectorAll('[data-tag]').forEach(button=>button.onclick=()=>attempt(async()=>{state.view='all';state.tag=button.dataset.tag;state.text='';$('#search').value='';renderNavigation();await load();}));
    $('#result-count').textContent='';$('#selection-status').textContent=`${tags.length} 个标签`;icons();return;
  }
  const result=await api.query({view:state.view,folderId:state.folderId,smartId:state.smartId,randomSeed:state.randomSeed,...currentCriteria(),sort:state.sort,offset:more?state.items.length:0,limit:100});
  if(req!==state.request)return;
  state.items=more?[...state.items,...result.items]:result.items;state.total=result.total;
  const available=new Set(state.items.map(i=>i.id));state.selected=new Set([...state.selected].filter(id=>available.has(id)));
  if(state.active&&!available.has(state.active))state.active=null;
  if(!more)$('#grid-scroll').scrollTop=0;
  renderGrid();updateSelection();renderInspector();icons();
}
function renderGrid() {
  $('#result-count').textContent=state.total.toLocaleString();
  $('#grid').innerHTML=state.items.map(item=>`<button draggable="true" style="--aspect:${Math.min(2.5,Math.max(.55,item.width&&item.height?item.width/item.height:1))}" class="asset-card ${state.selected.has(item.id)?'selected':''}" data-id="${esc(item.id)}" title="${esc(item.name)}.${esc(item.ext)}" aria-label="${esc(item.name)}" aria-pressed="${state.selected.has(item.id)}"><div class="thumbnail"><span class="format-badge">${esc(item.ext.toUpperCase()||'FILE')}</span>${item.thumbURL?`<img src="${esc(item.thumbURL)}" loading="lazy" draggable="false" alt=""><span class="broken-fallback hidden">${icon('image-off')}</span>`:`<span class="file-placeholder ${item.kind}">${item.kind==='font'?'Aa':icon({video:'film',audio:'audio-lines',file:'file'}[item.kind]||'image')}</span>`}${item.kind==='video'?`<span class="play-cue">${icon('play')}</span>`:''}${item.source==='local'?'<span class="local-dot" title="独立导入"></span>':''}</div><div class="card-name">${esc(item.name)}<span class="card-ext">.${esc(item.ext)}</span></div><div class="card-meta">${duration(item.duration)||bytes(item.size)}${item.tags.length?' · '+item.tags.length+' 标签':''}</div></button>`).join('');
  $('#grid').querySelectorAll('.asset-card').forEach(button=>{
    button.onclick=e=>select(button.dataset.id,e);
    button.ondblclick=()=>attempt(()=>showPreview(button.dataset.id));
    button.ondragstart=e=>{if(!state.selected.has(button.dataset.id))select(button.dataset.id);e.dataTransfer.setData('application/x-eagle-open-items',JSON.stringify([...state.selected]));e.dataTransfer.effectAllowed='copyMove';};
  });
  $('#grid').querySelectorAll('img').forEach(img=>img.onerror=()=>{img.classList.add('hidden');img.nextElementSibling?.classList.remove('hidden');});
  $('#empty').classList.toggle('hidden',state.total!==0);
  if(!state.total){$('#empty h2').textContent=state.text||state.kind!=='all'||state.tag?'没有匹配的素材':state.view==='trash'?'回收站是空的':state.folderId?'这个文件夹还没有素材':'把灵感收进来';$('#empty p').innerHTML=state.text||state.kind!=='all'||state.tag?'换个关键词，或调整筛选条件':'拖入图片、视频、音频或文件夹<br>也可以从上方导入素材';$('#empty-import').classList.toggle('hidden',state.view==='trash');}
  $('#load-more').classList.toggle('hidden',state.items.length>=state.total);
  $('#load-more').textContent=`加载更多 · 已显示 ${state.items.length} / ${state.total}`;
}
function select(id,event={}) {
  if(event.shiftKey&&state.anchor){const from=state.items.findIndex(i=>i.id===state.anchor),to=state.items.findIndex(i=>i.id===id);if(from>=0)for(let i=Math.min(from,to);i<=Math.max(from,to);i++)state.selected.add(state.items[i].id);}
  else if(event.metaKey||event.ctrlKey){state.selected.has(id)?state.selected.delete(id):state.selected.add(id);state.anchor=id;}
  else{state.selected=new Set([id]);state.anchor=id;}
  state.active=state.selected.has(id)?id:[...state.selected][0]||null;
  $('#grid').querySelectorAll('.asset-card').forEach(button=>{const selected=state.selected.has(button.dataset.id);button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));});
  updateSelection();renderInspector();
}
function updateSelection(){ $('#selection-status').textContent=state.selected.size?`已选择 ${state.selected.size} 项 · ${bytes(selectedItems().reduce((sum,i)=>sum+i.size,0))}`:`共 ${state.total.toLocaleString()} 份素材`; }
async function save(ids,patch,message='已保存') {
  await api.edit(ids,patch);await summary();await load();renderInspector();toast(message);
}
function renderInspector() {
  const items=selectedItems(),panel=$('#inspector');
  delete panel.dataset.itemId;
  if(!items.length){panel.innerHTML=`<div class="inspector-title">素材详情${icon('panel-right')}</div><div class="inspector-empty"><div>${icon('mouse-pointer-2')}</div><h3>选中一份素材</h3><p>查看预览、添加标签<br>让下次寻找更容易</p></div><div class="library-info"><span>素材库概况</span><div><small>原 Eagle 素材</small><b>${state.summary?.sourceCount.toLocaleString()||0}</b></div><div><small>独立导入</small><b>${state.summary?.localCount.toLocaleString()||0}</b></div><p>在这里的整理与编辑独立保存。</p></div>`;icons();return;}
  const item=items.find(i=>i.id===state.active)||items[0], multiple=items.length>1;
  if(!multiple) panel.dataset.itemId=item.id;
  panel.innerHTML=`<div class="inspector-title">${multiple?'批量整理':'素材详情'}<span class="source-badge">${multiple?items.length+' 项':item.source==='eagle'?'Eagle 素材':'独立导入'}</span></div>${multiple?`<div class="multi-summary">${icon('files')}<strong>${items.length} 份素材</strong><span>${bytes(items.reduce((n,i)=>n+i.size,0))}</span></div>`:`<button class="inspector-preview" id="inspector-preview" title="打开预览 · 空格" aria-label="打开素材预览">${item.thumbURL?`<img src="${esc(item.thumbURL)}" alt="${esc(item.name)}">`:`<span class="file-placeholder ${item.kind}">${item.kind==='font'?'Aa':icon(item.kind==='audio'?'audio-lines':'file')}</span>`}<span class="preview-open">${icon('maximize-2')}</span></button><input id="item-name" class="item-name" aria-label="素材名称" value="${esc(item.name)}" maxlength="500"><div class="item-type">${esc(item.ext.toUpperCase())} · ${kinds[item.kind]}</div>`}
    <section class="inspector-section"><div class="field-heading">标签${icon('tag')}</div><div class="tags-wrap" id="item-tags">${(multiple?[]:item.tags).map(t=>`<span class="tag-pill">${esc(t)}<button data-remove-tag="${esc(t)}" aria-label="移除标签 ${esc(t)}">×</button></span>`).join('')}</div><form id="tag-form"><input id="tag-input" placeholder="${multiple?'批量添加标签，回车保存':'添加标签，回车保存'}" aria-label="添加标签" list="tag-suggestions" maxlength="100"><datalist id="tag-suggestions">${state.summary.tags.slice(0,300).map(t=>`<option value="${esc(t.name)}"></option>`).join('')}</datalist></form></section>
    <section class="inspector-section"><div class="field-heading">文件夹<button id="assign" class="icon-button" title="编辑分类" aria-label="编辑分类">${icon('plus')}</button></div><div class="assigned-folders">${!multiple&&item.folders.length?item.folders.map(id=>`<div>${icon('folder')}<span>${esc(state.summary.folders.find(f=>f.id===id)?.name||'未找到文件夹')}</span></div>`).join(''):'<span class="muted">'+(multiple?'为所选素材设置分类':'尚未分类')+'</span>'}</div></section>
    ${multiple?'':`<section class="inspector-section"><div class="field-heading">描述</div><textarea id="annotation" placeholder="记录用途、灵感或来源…" aria-label="素材描述" maxlength="50000">${esc(item.annotation)}</textarea></section><section class="inspector-section"><div class="field-heading">基本信息</div><dl><dt>文件大小</dt><dd>${bytes(item.size)}</dd>${item.width?`<dt>尺寸</dt><dd>${item.width} × ${item.height}</dd>`:''}${item.duration?`<dt>时长</dt><dd>${duration(item.duration)}</dd>`:''}<dt>添加日期</dt><dd>${date(item.createdAt)}</dd><dt>来源</dt><dd>${esc(item.sourceName)}</dd></dl></section>`}
    <div class="inspector-bottom">${!multiple?`<button id="reveal" class="secondary">${icon('folder-search')}在 Finder 中显示</button>`:''}<button id="trash" class="text-button ${state.view==='trash'?'':'danger'}">${icon(state.view==='trash'?'rotate-ccw':'trash-2')}${state.view==='trash'?'恢复所选素材':'移入回收站'}</button><p>${item.source==='eagle'?'编辑保存在独立库，原 Eagle 文件保留。':'原始来源文件保留，导入副本独立保存。'}</p></div>`;
  const ids=items.map(i=>i.id);
  const details=document.createElement('section');details.className='inspector-section';
  details.innerHTML=`<div class="field-heading">星级</div><div class="rating-row">${[1,2,3,4,5].map(n=>`<button data-rating="${n}" aria-label="${n} 星" class="${!multiple&&(item.rating||0)>=n?'filled':''}">★</button>`).join('')}<button data-rating="0" class="clear-rating" aria-label="清除评分">清除</button></div>${!multiple?`<div class="field-heading source-heading">来源网址</div><input id="item-url" aria-label="来源网址" value="${esc(item.url||'')}" placeholder="https://…" maxlength="16384">${item.url?'<button id="open-source" class="text-button">打开来源网页</button>':''}${item.downloadURL&&item.downloadURL!==item.url?`<div class="media-url" title="${esc(item.downloadURL)}">媒体地址：${esc(item.downloadURL)}</div>`:''}`:''}`;
  panel.querySelector('.inspector-bottom').before(details);
  details.querySelectorAll('[data-rating]').forEach(button=>button.onclick=()=>attempt(()=>save(ids,{rating:Number(button.dataset.rating)},'评分已保存')));
  if(!multiple){$('#item-url').onchange=e=>attempt(()=>save([item.id],{url:e.target.value}));if($('#open-source'))$('#open-source').onclick=()=>attempt(()=>api.openURL(item.url));}
  const exportButton=document.createElement('button');exportButton.id='export-files';exportButton.className='secondary';exportButton.innerHTML=icon('upload')+'导出原文件';
  exportButton.onclick=()=>attempt(async()=>{const result=await api.exportFiles(ids);if(result)toast(`已导出 ${result.count} 份原文件`);});panel.querySelector('.inspector-bottom').prepend(exportButton);
  if(!multiple){
    $('#inspector-preview').onclick=()=>attempt(()=>showPreview(item.id));
    $('#item-name').onchange=e=>attempt(()=>save([item.id],{name:e.target.value}));
    $('#annotation').onchange=e=>attempt(()=>save([item.id],{annotation:e.target.value}));
    $('#reveal').onclick=()=>attempt(()=>api.reveal(item.id));
  }
  $('#tag-form').onsubmit=e=>{e.preventDefault();const tag=$('#tag-input').value.trim();if(!tag)return;attempt(async()=>{for(const i of items)await api.edit([i.id],{tags:[...new Set([...i.tags,tag])]});await summary();await load();renderInspector();toast('标签已保存');});};
  panel.querySelectorAll('[data-remove-tag]').forEach(button=>button.onclick=()=>attempt(()=>save([item.id],{tags:item.tags.filter(t=>t!==button.dataset.removeTag)})));
  $('#assign').onclick=()=>assignDialog(items);
  $('#trash').onclick=()=>attempt(()=>save(ids,{deleted:state.view!=='trash'},state.view==='trash'?'已恢复素材':'已移入独立回收站，可随时恢复'));
  icons();
}
window.flushPendingEdits=async()=>{
  if(state.busy){toast('正在保存导入任务，完成后自动关闭…',false,true);await importQueue;}
  const id=$('#inspector').dataset.itemId;
  if(!id)return;
  const item=await api.item(id),patch={},name=$('#item-name')?.value,annotation=$('#annotation')?.value,url=$('#item-url')?.value;
  if(name!==undefined&&name!==item.name)patch.name=name;
  if(annotation!==undefined&&annotation!==item.annotation)patch.annotation=annotation;
  if(url!==undefined&&url!==(item.url||''))patch.url=url;
  if(Object.keys(patch).length)await api.edit([id],patch);
};
function folderOptions(selected=null) {
  const rows=[];const visit=(parent,depth)=>{for(const f of state.summary.folders.filter(f=>f.parentId===parent)){rows.push(`<option value="${esc(f.id)}" ${f.id===selected?'selected':''}>${'　'.repeat(Math.min(depth,6))}${esc(f.name)}</option>`);visit(f.id,depth+1);}};visit(null,0);return rows.join('');
}
let editingFolder=null;
function newFolder(){ editingFolder=null;$('#folder-dialog h2').textContent='新建文件夹';$('#folder-form button[type=submit]').textContent='创建文件夹';$('#folder-parent').innerHTML='<option value="">素材库根目录</option>'+folderOptions(state.folderId);$('#folder-name').value='';$('#folder-dialog').showModal();$('#folder-name').focus(); }
function editFolder(id){ const folder=state.summary.folders.find(f=>f.id===id);if(!folder)return;newFolder();editingFolder=id;$('#folder-dialog h2').textContent='编辑文件夹';$('#folder-form button[type=submit]').textContent='保存';$('#folder-name').value=folder.name;$('#folder-parent').innerHTML='<option value="">素材库根目录</option>'+folderOptions(folder.parentId); }
function assignDialog(items){
  const selected=items.length===1?items[0].folders:[];
  $('#assign-dialog h2').textContent=items.length>1?`设置 ${items.length} 份素材的分类`:'整理到文件夹';
  $('#assign-dialog p').textContent=items.length>1?'保存后会替换所选素材现有的分类。':'可以同时加入多个分类；取消全部勾选可移出分类。';
  $('#assign-folders').innerHTML=state.summary.folders.map(f=>`<label><input type="checkbox" name="folder" value="${esc(f.id)}" ${selected.includes(f.id)?'checked':''}>${icon('folder')}<span>${esc(f.name)}</span>${f.source==='local'?'<small>新建</small>':''}</label>`).join('')||'<p>请先创建一个文件夹。</p>';
  $('#assign-form').onsubmit=e=>{e.preventDefault();const ids=[...$('#assign-folders').querySelectorAll('input:checked')].map(el=>el.value);attempt(async()=>{await save(items.map(i=>i.id),{folders:ids},'分类已保存');$('#assign-dialog').close();});};
  $('#assign-dialog').showModal();icons();
}
let fontFace;
async function showPreview(id) {
  const item=state.items.find(i=>i.id===id)||await api.item(id);state.active=id;
  await api.recordOpen(id);
  const dialog=$('#preview-dialog'),body=$('#preview-body');body.replaceChildren();
  $('#preview-name').textContent=item.name+(item.ext?'.'+item.ext:'');
  $('#preview-info').textContent=[item.ext.toUpperCase(),item.width?`${item.width} × ${item.height}`:'',bytes(item.size),duration(item.duration)].filter(Boolean).join(' · ');
  if(item.kind==='image') body.innerHTML=`<img class="full-image" src="${esc(item.mediaURL)}" alt="${esc(item.name)}">`;
  else if(['video','audio'].includes(item.kind)){
    body.innerHTML=`${item.kind==='audio'?`<div class="audio-art">${icon('audio-lines')}<strong>${esc(item.name)}</strong></div>`:''}<${item.kind} controls ${item.kind==='video'?'playsinline':''} preload="metadata" src="${esc(item.mediaURL)}"></${item.kind}><div id="media-error" class="media-error hidden">当前格式无法在应用内解码。<button id="external-open" class="secondary">用默认应用打开</button></div>`;
    const media=body.querySelector(item.kind);media.onerror=()=>$('#media-error')?.classList.remove('hidden');$('#external-open').onclick=()=>attempt(()=>api.openFile(item.id));
  } else if(item.kind==='font') {
    body.innerHTML='<div class="font-sheet"><span>FONT PREVIEW / 字体预览</span><div id="font-sample">山川与灵感<br>Ideas come alive.<br>ABCDEFGHIJKLMNOPQRSTUVWXYZ<br>0123456789</div><p>部分字体可能不包含中文，缺字将使用系统字体。</p></div>';
    if(fontFace)document.fonts.delete(fontFace);
    try {fontFace=await new FontFace('AssetPreview',`url("${item.mediaURL}")`).load();document.fonts.add(fontFace);$('#font-sample').style.fontFamily='AssetPreview, sans-serif';}
    catch {$('#font-sample').textContent='此字体格式暂不支持内置预览。请在 Finder 中查看。';}
  } else body.innerHTML=`<div class="unsupported">${icon('file')}<h2>${esc(item.name)}</h2><p>此格式暂不支持内置预览</p><button id="preview-reveal" class="secondary">在 Finder 中显示</button></div>`;
  if($('#preview-reveal'))$('#preview-reveal').onclick=()=>attempt(()=>api.reveal(item.id));
  body.querySelector('img')?.addEventListener('error',()=>{body.innerHTML='<div class="unsupported"><h2>图片暂时无法解码</h2><p>可从详情栏在 Finder 中显示原文件。</p></div>';});
  if(!dialog.open)dialog.showModal();icons();
}
function closePreview(){ $('#preview-dialog').close();$('#preview-body').replaceChildren(); }
async function stepPreview(delta){const index=state.items.findIndex(i=>i.id===state.active),next=state.items[index+delta];if(next)await showPreview(next.id);}
async function runImport(type='files') {
  if(state.busy)return;const folder=state.folderId;
  return enqueueImport(async()=>{const result=await api.chooseImport(type,folder);if(result)await finishImport(result);else $('#toast').classList.add('hidden');});
}
function setImportBusy(busy){ $('#import').disabled=busy;$('#import-folder').disabled=busy;$('#capture').disabled=busy; }
let importQueue=Promise.resolve(),pendingImports=0;
function enqueueImport(task){
  pendingImports++;if(pendingImports>1)toast(`已排队，还有 ${pendingImports-1} 批素材等待导入`,false,true);
  state.busy=true;setImportBusy(true);
  const operation=importQueue.then(task).finally(()=>{pendingImports--;state.busy=pendingImports>0;setImportBusy(state.busy);});
  importQueue=operation.catch(()=>{});return operation;
}
async function importDrop(event,folder=state.folderId){
  const job=window.mediaDropJob(event.dataTransfer,api,folder);
  if(!job){toast('未识别到文件或可下载的媒体链接；可先保存文件再导入',true);return;}
  return enqueueImport(async()=>finishImport(await job()));
}
async function finishImport(result){
  await summary();await load();renderInspector();
  toast(`导入完成：${result.imported.length} 份新增${result.duplicates.length?'，'+result.duplicates.length+' 份重复已略过':''}${result.skipped.length?'，'+result.skipped.length+' 项提示':''}`);
  if(result.skipped.length){$('#import-details').innerHTML=result.skipped.map(x=>`<p><strong>${esc(x.name)}</strong><br>${esc(x.reason)}</p>`).join('');$('#import-report').showModal();}
}
$('#capture').onclick=()=>{ $('#capture-urls').value='';$('#capture-source').value='';$('#capture-folder').innerHTML='<option value="">素材库根目录</option>'+folderOptions(state.folderId);$('#capture-dialog').showModal();$('#capture-urls').focus(); };
$('#capture-form').onsubmit=event=>{event.preventDefault();if(state.busy)return;const sourceURL=$('#capture-source').value.trim(),items=$('#capture-urls').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).map(url=>({url,...(sourceURL?{sourceURL}:{})})),folder=$('#capture-folder').value||null;$('#capture-dialog').close();attempt(()=>enqueueImport(async()=>finishImport(await api.captureMedia(items,folder))));};
$('#import').onclick=()=>attempt(()=>runImport());$('#import-folder').onclick=()=>attempt(()=>runImport('folder'));$('#empty-import').onclick=()=>attempt(()=>runImport());
$('#new-folder').onclick=newFolder;$('#folder-filter').oninput=renderFolders;
$('#folder-form').onsubmit=e=>{e.preventDefault();attempt(async()=>{const id=editingFolder;if(id)await api.editFolder(id,$('#folder-name').value,$('#folder-parent').value||null);const folder=id?{id}:await api.createFolder($('#folder-name').value,$('#folder-parent').value||null);$('#folder-dialog').close();await summary();await navigate('folder',folder.id);toast(id?'文件夹已保存':'文件夹已创建');});};
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>document.getElementById(button.dataset.close).close());
$('#connect').onclick=()=>attempt(async()=>{const result=await api.connectSource();if(result){await summary();await load();renderInspector();toast('Eagle 库已只读接入');}});
const refresh=()=>attempt(async()=>{toast('正在重新读取原库…',false,true);await api.refresh();await summary();await load();renderInspector();toast('素材库已刷新');});
$('#refresh').onclick=refresh;
$('#search').oninput=e=>{state.text=e.target.value;$('#clear-search').classList.toggle('hidden',!state.text);clearTimeout(searchTimer);searchTimer=setTimeout(()=>attempt(()=>load()),140);};
$('#clear-search').onclick=()=>{state.text='';$('#search').value='';$('#clear-search').classList.add('hidden');attempt(()=>load());};
$('#kind').onchange=e=>{state.kind=e.target.value;attempt(()=>load());};
function currentCriteria(){return {text:state.text,kind:state.kind,tag:state.tag,minRating:Number($('#min-rating').value),minWidth:Number($('#min-width').value)||0,minHeight:Number($('#min-height').value)||0,ext:$('#filter-ext').value.trim()};}
function clearAdvanced(){for(const id of ['min-width','min-height','filter-ext'])$('#'+id).value='';$('#min-rating').value='0';}
$('#toggle-filters').onclick=()=>$('#advanced-filters').classList.toggle('hidden');
for(const id of ['min-rating','min-width','min-height','filter-ext'])$('#'+id).onchange=()=>attempt(()=>load());
$('#clear-filters').onclick=()=>{clearAdvanced();attempt(()=>load());};
const smartDialog=()=>{ $('#smart-name').value='';$('#smart-dialog').showModal();$('#smart-name').focus(); };
$('#new-smart').onclick=smartDialog;$('#save-smart').onclick=smartDialog;
$('#smart-form').onsubmit=e=>{e.preventDefault();attempt(async()=>{const folder=await api.createSmartFolder($('#smart-name').value,currentCriteria());$('#smart-dialog').close();await summary();toast(`智能文件夹「${folder.name}」已保存`);});};
$('#layout').onchange=()=>attempt(async()=>{applyLayout($('#layout').value);await api.preferences({layout:$('#layout').value});});
function applyLayout(layout){$('#grid').classList.toggle('layout-masonry',layout==='masonry');$('#grid').classList.toggle('layout-list',layout==='list');}
$('#sort').onchange=e=>{state.sort=e.target.value;attempt(async()=>{await api.preferences({sort:state.sort});await load();});};
$('#zoom').oninput=e=>document.documentElement.style.setProperty('--thumb-size',e.target.value+'px');
$('#zoom').onchange=e=>attempt(()=>api.preferences({thumbSize:Number(e.target.value)}));
$('#load-more').onclick=()=>attempt(()=>load(true));
$('#preview-close').onclick=closePreview;$('#preview-prev').onclick=()=>attempt(()=>stepPreview(-1));$('#preview-next').onclick=()=>attempt(()=>stepPreview(1));
$('#preview-dialog').addEventListener('cancel',e=>{e.preventDefault();closePreview();});
document.addEventListener('keydown',event=>{
  const editing=['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName);
  if((event.metaKey||event.ctrlKey)&&event.key==='f'){event.preventDefault();$('#search').focus();return;}
  if($('#preview-dialog').open){if(event.key==='ArrowLeft'){event.preventDefault();attempt(()=>stepPreview(-1));}if(event.key==='ArrowRight'){event.preventDefault();attempt(()=>stepPreview(1));}return;}
  if(editing||document.querySelector('dialog[open]'))return;
  if(event.code==='Space'&&state.active){event.preventDefault();attempt(()=>showPreview(state.active));}
  if((event.metaKey||event.ctrlKey)&&event.key==='a'){event.preventDefault();state.selected=new Set(state.items.map(i=>i.id));renderGrid();updateSelection();renderInspector();icons();}
  if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)&&state.items.length){
    event.preventDefault();const cols=Math.max(1,getComputedStyle($('#grid')).gridTemplateColumns.split(' ').filter(Boolean).length),index=state.items.findIndex(i=>i.id===state.active);
    const step={ArrowLeft:-1,ArrowRight:1,ArrowUp:-cols,ArrowDown:cols}[event.key];const next=state.items[Math.max(0,Math.min(state.items.length-1,index+step))];if(next){select(next.id);[...$('#grid').children].find(b=>b.dataset.id===next.id)?.scrollIntoView({block:'nearest'});}
  }
});
let dragDepth=0;
document.addEventListener('dragenter',e=>{if([...e.dataTransfer.types].some(t=>['Files','text/uri-list','text/plain','text/html','text/x-moz-url','DownloadURL'].includes(t))){e.preventDefault();$('#drop-overlay').classList.remove('hidden');}});
document.addEventListener('dragleave',e=>{if(!e.relatedTarget&&(e.clientX<=0||e.clientY<=0||e.clientX>=innerWidth||e.clientY>=innerHeight))clearDrag();});
document.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';});
const clearDrag=()=>{dragDepth=0;$('#drop-overlay').classList.add('hidden');};
document.addEventListener('dragend',clearDrag);
window.addEventListener('blur',clearDrag);
document.addEventListener('keydown',e=>{if(e.key==='Escape')clearDrag();});
document.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;$('#drop-overlay').classList.add('hidden');attempt(()=>importDrop(e));});
api.onProgress(progress=>toast(progress.phase==='download'?`正在采集 ${progress.completed} / ${progress.total}${progress.bytes?' · '+bytes(progress.bytes)+(progress.totalBytes?' / '+bytes(progress.totalBytes):''):''}`:`正在导入 ${progress.completed} / ${progress.total}${progress.name?' · '+progress.name:''}`,false,true));
api.onMenu(action=>{if(action==='import')attempt(()=>runImport());if(action==='folder')newFolder();if(action==='refresh')refresh();if(action==='search')$('#search').focus();});
attempt(async()=>{
  await summary();
  const prefs=state.summary.preferences;state.sort=prefs.sort||'newest';$('#sort').value=state.sort;
  $('#layout').value=prefs.layout||'grid';applyLayout($('#layout').value);
  const size=prefs.thumbSize||180;$('#zoom').value=size;document.documentElement.style.setProperty('--thumb-size',size+'px');
  for(const f of state.summary.folders)if(state.summary.folders.some(c=>c.parentId===f.id))state.collapsed.add(f.id);
  renderFolders();await load();renderInspector();icons();
});
