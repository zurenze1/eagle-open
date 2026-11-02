const { _electron } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { hashFile } = require('../src/library.cjs');
const root = path.resolve(__dirname,'..'), verification = path.resolve(root,'../verification');
const report = { checks: [], errors: [], passed: false, dropScope: 'Renderer DataTransfer contract plus in-app drag; OS cross-application drag is a separate check.' };
let app, server;
const check = name => { report.checks.push(name); console.log('PASS',name); };
(async()=>{
  await fs.mkdir(verification,{recursive:true});
  const sandbox = await fs.mkdtemp(path.join(verification,'capture-ui-')),data=path.join(sandbox,'data');
  const media = { '/image': ['image/png','图片预览测试.png'], '/audio': ['audio/wav','音频预览测试.wav'], '/video': ['video/mp4','视频预览测试.mp4'] };
  server = http.createServer(async(req,res)=>{
    if(media[req.url]){const [type,name]=media[req.url];res.writeHead(200,{'Content-Type':type,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(name)}`});res.end(await fs.readFile(path.join(verification,'fixtures',name)));}
    else {res.writeHead(200,{'Content-Type':'text/html'});res.end('<h1>Player / login page</h1>');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  const env={...process.env,EAGLE_OPEN_DATA:data,EAGLE_OPEN_NO_SOURCE:'1'};delete env.ELECTRON_RUN_AS_NODE;
  const launch=async()=>{const launched=await _electron.launch({executablePath:process.env.EAGLE_OPEN_TEST_BINARY||require('electron'),args:process.env.EAGLE_OPEN_TEST_BINARY?[]:[root],env});const page=await launched.firstWindow();page.on('pageerror',e=>report.errors.push(e.message));await page.locator('#library-subtitle').filter({hasText:'份素材'}).waitFor();return {launched,page};};
  let session=await launch();app=session.launched;let page=session.page;
  await page.locator('#capture').click();await page.locator('#capture-urls').fill(['/image','/audio','/video'].map(s=>origin+s).join('\n'));await page.locator('#capture-source').fill(origin+'/article');await page.locator('#capture-form button[type=submit]').click();
  await page.locator('#toast').filter({hasText:'3 份新增'}).waitFor({timeout:30000});assert.equal(await page.locator('.asset-card').count(),3);
  let state=JSON.parse(await fs.readFile(path.join(data,'library.json'),'utf8'));
  for(const item of state.items){assert.equal(item.url,origin+'/article');assert.equal(item.hash,await hashFile(path.join(verification,'fixtures',item.name+'.'+item.ext)));}
  check('链接采集界面真实下载三类文件，原件哈希和来源网址一致');
  await page.locator('.asset-card').filter({hasText:'音频预览测试'}).dblclick();await page.waitForFunction(()=>document.querySelector('audio')?.readyState>=2);await page.evaluate(async()=>{const m=document.querySelector('audio');m.muted=true;await m.play();});await page.waitForFunction(()=>document.querySelector('audio').currentTime>.15);await page.locator('#preview-close').click();check('网络采集音频在客户端实际播放');
  await page.locator('.asset-card').filter({hasText:'图片预览测试'}).click();await page.locator('[data-rating="4"]').click();await page.locator('.rating-row button.filled').nth(3).waitFor();
  await page.locator('#toggle-filters').click();await page.locator('#min-rating').selectOption('4');await page.locator('#kind').selectOption('image');await page.waitForFunction(()=>document.querySelectorAll('.asset-card').length===1);
  await page.locator('#save-smart').click();await page.locator('#smart-name').fill('四星灵感');await page.locator('#smart-form button[type=submit]').click();await page.locator('[data-smart]').filter({hasText:'四星灵感'}).waitFor();
  await page.locator('[data-smart]').filter({hasText:'四星灵感'}).click();assert.equal(await page.locator('.asset-card').count(),1);await page.locator('.asset-card').first().click();await page.locator('[data-rating="2"]').click();await page.waitForFunction(()=>document.querySelector('#result-count').textContent==='0');check('评分和智能文件夹通过实际筛选动态更新');
  await page.locator('[data-view="all"]').click();await page.locator('#new-folder').click();await page.locator('#folder-name').fill('拖入分类');await page.locator('#folder-form button[type=submit]').click();await page.locator('#view-title').filter({hasText:'拖入分类'}).waitFor();
  const transfer=await page.evaluateHandle(({origin})=>{const t=new DataTransfer();t.setData('text/html',`<a href="${origin}/second-article"><img src="${origin}/image" alt="采集图"></a>`);t.setData('text/uri-list',origin+'/second-article');return t;},{origin});
  await page.dispatchEvent('#grid-scroll','drop',{dataTransfer:transfer});await page.locator('#toast').filter({hasText:'重复已略过'}).waitFor();assert.equal(await page.locator('.asset-card').count(),1);
  state=JSON.parse(await fs.readFile(path.join(data,'library.json'),'utf8'));const image=state.items.find(i=>i.kind==='image');assert.ok(state.overlays[image.id].urls.includes(origin+'/second-article'));check('网页 HTML 拖放合约保存图片地址、来源网页与目标分类，重复素材不产生副本');
  await page.locator('[data-view="all"]').click();await page.locator('.asset-card').filter({hasText:'视频预览测试'}).dragTo(page.locator('.folder-button').filter({hasText:'拖入分类'}));await page.locator('#toast').filter({hasText:'已加入文件夹'}).waitFor();await page.locator('.folder-button').filter({hasText:'拖入分类'}).click();assert.equal(await page.locator('.asset-card').count(),2);check('素材在应用内真实拖入文件夹并保留原分类');
  await page.locator('.folder-button').filter({hasText:'拖入分类'}).click({button:'right'});await page.locator('#folder-name').fill('重新命名分类');await page.locator('#folder-form button[type=submit]').click();await page.locator('#view-title').filter({hasText:'重新命名分类'}).waitFor();check('右键编辑文件夹名称实际保存');
  await page.locator('.asset-card').filter({hasText:'图片预览测试'}).click();const exported=path.join(sandbox,'export');await fs.mkdir(exported);await fs.writeFile(path.join(exported,image.name+'.'+image.ext),'preserve existing');
  await app.evaluate(({dialog},file)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]}),exported);await page.locator('#export-files').click();await page.locator('#toast').filter({hasText:'已导出 1 份原文件'}).waitFor();assert.equal(await fs.readFile(path.join(exported,image.name+'.'+image.ext),'utf8'),'preserve existing');assert.equal(await hashFile(path.join(exported,image.name+' (1).'+image.ext)),image.hash);check('导出原文件哈希一致，保留已有同名文件');
  await page.locator('#capture').click();await page.locator('#capture-urls').fill(origin+'/page');await page.locator('#capture-form button[type=submit]').click();await page.locator('#import-report[open]').waitFor();assert.match(await page.locator('#import-details').textContent(),/网页|登录/);await page.locator('[data-close="import-report"]').click();check('播放器或登录网页提供可见失败原因');
  for(const layout of ['list','masonry','grid']){await page.locator('#layout').selectOption(layout);assert.ok(await page.locator('.asset-card').count());}
  await page.screenshot({path:path.join(verification,'capture-workflow.png')});check('网格、自适应和列表布局可切换');
  await app.close();app=null;session=await launch();app=session.launched;page=session.page;await page.locator('[data-smart]').filter({hasText:'四星灵感'}).waitFor();assert.equal(await page.locator('.asset-card').count(),3);await page.locator('[data-view="recent"]').click();await page.waitForFunction(()=>document.querySelector('#result-count').textContent==='1');check('退出重启后采集素材、评分、智能文件夹与最近使用保持');
  assert.deepEqual(report.errors,[]);report.passed=true;report.sandbox=sandbox;report.completedAt=new Date().toISOString();
})().catch(error=>{report.error=error.stack;console.error(error);process.exitCode=1;}).finally(async()=>{if(app)await app.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await fs.writeFile(path.join(verification,'capture-ui-report.json'),JSON.stringify(report,null,2));});
