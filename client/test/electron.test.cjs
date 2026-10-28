const { _electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { hashFile } = require('../src/library.cjs');
const root=path.resolve(__dirname,'..'),verification=path.resolve(root,'../verification');
const report={startedAt:new Date().toISOString(),checks:[],errors:[]};
let application;
const check=(name,details={})=>{report.checks.push({name,passed:true,...details});console.log('PASS',name);};
const launch=async(data,source=false,packaged=null)=>{
  const env={...process.env,EAGLE_OPEN_DATA:data};delete env.ELECTRON_RUN_AS_NODE;
  if(!source)env.EAGLE_OPEN_NO_SOURCE='1';else delete env.EAGLE_OPEN_NO_SOURCE;
  const launched=await _electron.launch({executablePath:packaged||require('electron'),args:packaged?[]:[root],env,timeout:30000});
  const page=await launched.firstWindow();page.on('pageerror',error=>report.errors.push(error.message));
  await page.locator('#library-subtitle').filter({hasText:/份素材/}).waitFor();return {application:launched,page};
};
async function main(){
  await fs.mkdir(verification,{recursive:true});const sandbox=await fs.mkdtemp(path.join(verification,'e2e-'));
  let session=await launch(path.join(sandbox,'data'));application=session.application;let page=session.page;
  assert.equal(await page.locator('#result-count').textContent(),'0');check('独立空库可启动');
  const fixtures=['图片预览测试.png','视频预览测试.mp4','音频预览测试.wav'].map(f=>path.join(verification,'fixtures',f));
  // 以 native dialog 返回值驱动真实导入按钮；文件系统使用沙盒，未操作用户原库。
  await application.evaluate(({dialog},paths)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:paths});},fixtures);
  await page.locator('#import').click();await page.locator('#toast').filter({hasText:'3 份新增'}).waitFor({timeout:30000});
  assert.equal(await page.locator('.asset-card').count(),3);check('导入按钮完成图片/视频/音频真实复制');
  const imported=await page.evaluate(()=>window.eagleOpen.query({view:'local'}));
  assert.equal(imported.total,3);const importedState=JSON.parse(await fs.readFile(path.join(sandbox,'data/library.json'),'utf8'));
  for(const item of importedState.items)assert.equal(await hashFile(item.filePath),await hashFile(fixtures.find(f=>path.parse(f).name===item.name)));
  assert.equal(importedState.items.find(i=>i.kind==='image').width,720);assert.ok(importedState.items.find(i=>i.kind==='video').thumbPath);check('导入副本哈希一致、图片尺寸与视频缩略图有效');
  const image=page.locator('.asset-card').filter({hasText:'图片预览测试'});await image.click();await page.keyboard.press('Space');
  await page.waitForFunction(()=>{const img=document.querySelector('#preview-body img');return img?.complete&&img.naturalWidth===720;});
  await page.screenshot({path:path.join(verification,'image-preview.png')});await page.locator('#preview-close').click();check('图片原图完成解码并打开空格预览');
  const mediaResults=[];
  for(const [kind,name] of [['video','视频预览测试'],['audio','音频预览测试']]){
    console.log('CHECK MEDIA',kind);
    await page.locator('.asset-card').filter({hasText:name}).dblclick();
    try{await page.waitForFunction(kind=>{const media=document.querySelector('#preview-body '+kind);return media&&media.readyState>=2&&media.duration>2.9;},kind,{timeout:10000,polling:100});}
    catch(e){console.log('LOAD DEBUG',kind,await page.evaluate(kind=>{const m=document.querySelector('#preview-body '+kind);return {time:m?.currentTime,duration:m?.duration,ready:m?.readyState,error:m?.error?.message,network:m?.networkState};},kind));throw e;}
    await page.evaluate(async kind=>{const media=document.querySelector('#preview-body '+kind);media.muted=true;await media.play();},kind);
    await page.waitForFunction(kind=>document.querySelector('#preview-body '+kind).currentTime>0.2,kind);
    await page.evaluate(kind=>{const media=document.querySelector('#preview-body '+kind);media.pause();media.currentTime=1.5;},kind);
    try { await page.waitForFunction(kind=>{const m=document.querySelector('#preview-body '+kind);return Math.abs(m.currentTime-1.5)<0.2&&!m.seeking&&m.readyState>=2;},kind,{timeout:10000,polling:100}); }
    catch(e){console.log('MEDIA DEBUG',kind,await page.evaluate(kind=>{const m=document.querySelector('#preview-body '+kind);return {time:m.currentTime,duration:m.duration,paused:m.paused,seeking:m.seeking,error:m.error?.message,seekable:Array.from({length:m.seekable.length},(_,i)=>[m.seekable.start(i),m.seekable.end(i)]),buffered:Array.from({length:m.buffered.length},(_,i)=>[m.buffered.start(i),m.buffered.end(i)])};},kind));throw e;}
    mediaResults.push({kind,...await page.evaluate(kind=>{const media=document.querySelector('#preview-body '+kind);return {duration:media.duration,currentTime:media.currentTime,readyState:media.readyState,error:media.error?.message||null};},kind)});
    await page.locator('#preview-close').click();
  }
  check('视频与音频真实播放、暂停、进度定位', {mediaResults});
  await image.click();await page.locator('#item-name').fill('已整理图片');await page.locator('#item-name').press('Tab');
  await page.locator('.asset-card').filter({hasText:'已整理图片'}).waitFor();
  await page.locator('#annotation').fill('用于人物故事的画面参考');await page.locator('#annotation').press('Tab');await page.locator('#toast').filter({hasText:'已保存'}).waitFor();
  await page.locator('#tag-input').fill('验收标签');await page.locator('#tag-input').press('Enter');await page.locator('.tag-pill').filter({hasText:'验收标签'}).waitFor();
  check('名称、描述、标签从详情栏保存');
  await page.locator('#new-folder').click();await page.locator('#folder-name').fill('验收分类');await page.locator('#folder-form button[type=submit]').click();
  await page.locator('#view-title').filter({hasText:'验收分类'}).waitFor();await page.locator('[data-view=all]').click();
  await page.locator('.asset-card').filter({hasText:'已整理图片'}).click();await page.locator('#assign').click();await page.locator('#assign-folders label').filter({hasText:'验收分类'}).locator('input').check();await page.locator('#assign-form button[type=submit]').click();
  await page.locator('#assign-dialog').waitFor({state:'hidden'});await page.locator('.folder-button').filter({hasText:'验收分类'}).click();
  assert.equal(await page.locator('.asset-card').count(),1);check('文件夹创建、素材分类及分类筛选');
  await page.locator('#search').fill('验收标签');await page.waitForFunction(()=>document.querySelectorAll('.asset-card').length===1);
  await page.locator('#kind').selectOption('video');await page.waitForFunction(()=>document.querySelector('#result-count').textContent==='0');
  await page.locator('#kind').selectOption('image');await page.waitForFunction(()=>document.querySelector('#result-count').textContent==='1');check('文字/标签搜索与类型筛选组合');
  await page.locator('#search').fill('');await page.locator('#clear-search').click().catch(()=>{});
  await page.locator('.asset-card').first().click();await page.locator('#trash').click();await page.waitForFunction(()=>document.querySelector('#result-count').textContent==='0');
  await page.locator('[data-view=trash]').click();await page.locator('.asset-card').first().click();await page.locator('#trash').click();await page.waitForFunction(()=>document.querySelector('#result-count').textContent==='0');check('独立回收站与恢复');
  await page.locator('[data-view=all]').click();await page.locator('#sort').selectOption('name');
  await page.locator('#zoom').fill('210');await page.locator('#zoom').dispatchEvent('input');await page.locator('#zoom').dispatchEvent('change');
  await page.waitForFunction(()=>getComputedStyle(document.documentElement).getPropertyValue('--thumb-size')==='210px');
  await page.locator('.asset-card').filter({hasText:'已整理图片'}).click();await page.screenshot({path:path.join(verification,'local-workflow.png')});
  await page.locator('#annotation').fill('关闭窗口时仍在输入的描述');
  await application.close();session=await launch(path.join(sandbox,'data'));application=session.application;page=session.page;
  assert.equal(await page.locator('#zoom').inputValue(),'210');assert.equal(await page.locator('#sort').inputValue(),'name');
  await page.locator('.asset-card').filter({hasText:'已整理图片'}).click();assert.equal(await page.locator('#annotation').inputValue(),'关闭窗口时仍在输入的描述');assert.ok(await page.locator('.tag-pill').filter({hasText:'验收标签'}).count());check('退出重启后编辑、分类、缩略图大小和排序持久化，关闭前未失焦的描述也保存');
  await application.close();
  // 设置 EAGLE_OPEN_SOURCE 时才执行真实库只读检查。
  if(process.env.EAGLE_OPEN_SOURCE){
  const source=process.env.EAGLE_OPEN_SOURCE, sourceMeta=path.join(source,'metadata.json'),before=await hashFile(sourceMeta);
  const sourceFiles=[sourceMeta,...(await fs.readdir(path.join(source,'images'))).filter(n=>n.endsWith('.info')).map(n=>path.join(source,'images',n,'metadata.json'))];
  const metadataBefore=await Promise.all(sourceFiles.map(async f=>({path:f,hash:await hashFile(f)})));
  session=await launch(path.join(sandbox,'source-data'),true);application=session.application;page=session.page;
  const diskMeta=await Promise.all(sourceFiles.slice(1).map(async f=>JSON.parse(await fs.readFile(f,'utf8'))));
  const diskActive=diskMeta.filter(m=>!m.isDeleted),diskTags=new Set(diskActive.flatMap(m=>m.tags||[]));
  const sourceSummary=await page.evaluate(()=>window.eagleOpen.summary());assert.equal(sourceSummary.sourceCount,diskActive.length);assert.equal(sourceSummary.tags.length,diskTags.size);check(`真实 Eagle 库 ${sourceSummary.sourceCount} 素材 / ${sourceSummary.folders.length} 分类 / ${sourceSummary.tags.length} 标签读取`,{sourceSummary:{total:sourceSummary.total,folders:sourceSummary.folders.length,tags:sourceSummary.tags.length}});
  assert.equal(await page.locator('.asset-card').count(),100);
  await page.locator('.asset-card').first().click();const columns=await page.locator('#grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length);
  await page.keyboard.press('ArrowDown');assert.equal(await page.locator('.asset-card').nth(columns).getAttribute('aria-pressed'),'true');await page.keyboard.press('ArrowUp');assert.equal(await page.locator('.asset-card').first().getAttribute('aria-pressed'),'true');
  await page.locator('#load-more').click();assert.equal(await page.locator('.asset-card').count(),200);check('真实大库分页加载 100 → 200，方向键按实际列数移动');
  await page.locator('#kind').selectOption('image');await page.waitForFunction(()=>document.querySelectorAll('.asset-card').length>0);await page.locator('.asset-card').first().click();
  await page.waitForFunction(()=>{const imgs=[...document.querySelectorAll('.thumbnail img')].slice(0,12);return imgs.length>0&&imgs.every(i=>i.complete&&i.naturalWidth>0);});
  await page.screenshot({path:path.join(verification,'real-library.png')});
  await page.locator('#kind').selectOption('font');await page.waitForFunction(()=>document.querySelector('.format-badge')?.textContent==='TTF'||document.querySelector('.format-badge')?.textContent==='OTF');
  const font=(await page.evaluate(()=>window.eagleOpen.query({kind:'font',limit:1}))).items[0];
  const fontMeta=JSON.parse(await fs.readFile(path.join(source,'images',font.id.split(':').at(-1)+'.info','metadata.json'),'utf8'));
  const fontFile=path.join(source,'images',fontMeta.id+'.info',fontMeta.name+'.'+fontMeta.ext),fontHashBefore=await hashFile(fontFile);
  await page.locator('.asset-card').first().dblclick();await page.waitForFunction(()=>document.querySelector('#font-sample')?.style.fontFamily.includes('AssetPreview'));check('真实库字体加载与文字预览');await page.locator('#preview-close').click();
  await page.locator('.asset-card').first().click();await page.locator('#item-name').fill('沙盒覆盖层测试名称');await page.locator('#item-name').press('Tab');await page.locator('.asset-card').filter({hasText:'沙盒覆盖层测试名称'}).waitFor();
  assert.equal(await hashFile(sourceMeta),before);const original=await page.evaluate(id=>window.eagleOpen.item(id),font.id);assert.equal(original.name,'沙盒覆盖层测试名称');
  const metadataAfter=await Promise.all(sourceFiles.map(async f=>({path:f,hash:await hashFile(f)})));
  assert.deepEqual(metadataAfter,metadataBefore);assert.equal(await hashFile(fontFile),fontHashBefore);
  check(`真实原库素材改名只写沙盒覆盖层，${metadataBefore.length} 份元数据与抽检原件哈希一致`,{metadataFiles:metadataBefore.length,fontHash:fontHashBefore});
  // 协议与 renderer 隔离：不允许任意文件/脚本读取。
  const security=await page.evaluate(async()=>({node:typeof window.require,source:await fetch('app://ui/main.cjs').then(r=>r.status),traversal:await fetch('app://ui/../../package.json').then(r=>r.status),asset:await fetch('asset://media/missing/original').then(r=>r.status)}));
  assert.equal(security.node,'undefined');assert.equal(security.source,403);assert.ok([403,404].includes(security.traversal));assert.equal(security.asset,404);check('Node 隔离、任意源文件与越界素材读取阻止',{security});
  await application.close();application=null;
  }else{report.skipped=['未指定 EAGLE_OPEN_SOURCE，略过可选原库检查'];}
  assert.deepEqual(report.errors,[]);report.sandbox=sandbox;report.completedAt=new Date().toISOString();report.passed=true;
}
main().catch(e=>{report.passed=false;report.failure=e.stack;console.error(e);process.exitCode=1;}).finally(async()=>{if(application)await application.close().catch(()=>{});await fs.writeFile(path.join(verification,'electron-test-report.json'),JSON.stringify(report,null,2));});
