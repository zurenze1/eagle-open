const { _electron } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root=path.resolve(__dirname,'..'),verification=path.resolve(root,'../verification');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const report={checks:[],errors:[],passed:false,scope:'Actual Electron import/preview/persistence driven with browser DataTransfer payloads; OS cross-application release recorded separately.'};
let app,server;
(async()=>{
  const sandbox=await fs.mkdtemp(path.join(verification,'web-drop-')),data=path.join(sandbox,'data');
  const image=await fs.readFile(path.join(verification,'fixtures/图片预览测试.png')),audio=await fs.readFile(path.join(verification,'fixtures/音频预览测试.wav'));
  const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#864e24"/></svg>');
  const requests=[];
  server=http.createServer((req,res)=>{
    requests.push(req.url);
    if(req.url==='/image'){res.setHeader('Content-Type','image/png');res.end(image);}
    else if(req.url==='/audio.wav'){res.setHeader('Content-Type','audio/wav');res.end(audio);}
    else if(req.url==='/logo.svg'){res.setHeader('Content-Type','image/svg+xml');res.end(svg);}
    else if(req.url==='/slow.svg'){res.setHeader('Content-Type','image/svg+xml');setTimeout(()=>res.end(svg.toString().replace('#864e24','#337733')),250);}
    else if(req.url==='/player'){res.setHeader('Content-Type','text/html');res.end('<title>公开音乐</title><audio controls><source src="/audio.wav" type="audio/wav"></audio>');}
    else if(req.url==='/two-players'){res.setHeader('Content-Type','text/html');res.end('<audio src="/audio.wav"></audio><audio src="/other.wav"></audio>');}
    else if(req.url==='/hls'){res.setHeader('Content-Type','application/vnd.apple.mpegurl');res.end('#EXTM3U');}
    else {res.setHeader('Content-Type','text/html');res.end('<h1>Login / unsupported page</h1>');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  const env={...process.env,EAGLE_OPEN_DATA:data,EAGLE_OPEN_NO_SOURCE:'1'};delete env.ELECTRON_RUN_AS_NODE;
  const launch=async()=>{const a=await _electron.launch({executablePath:process.env.EAGLE_OPEN_TEST_BINARY||require('electron'),args:process.env.EAGLE_OPEN_TEST_BINARY?[]:[root],env});const p=await a.firstWindow();p.on('pageerror',e=>report.errors.push(e.message));await p.locator('#library-subtitle').filter({hasText:'份素材'}).waitFor();await p.evaluate(()=>window.eagleOpen.preferences({collectorAuto:false}));await a.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.hide()));return {a,p};};
  let session=await launch();app=session.a;let page=session.p;
  const check=name=>{report.checks.push(name);console.log('PASS',name);};
  const drop=async(fields,target='#grid-scroll',file)=>{
    await page.waitForFunction(()=>!document.querySelector('#import').disabled);
    await page.locator('#toast').evaluate(el=>el.textContent='');
    const transfer=await page.evaluateHandle(({fields,file})=>{const t=new DataTransfer();for(const [k,v] of Object.entries(fields))t.setData(k,v);if(file)t.items.add(new File([new Uint8Array(file.bytes)],file.name,{type:file.type}));return t;},{fields,file});
    await page.dispatchEvent(target,'drop',{dataTransfer:transfer});await transfer.dispose();
    await page.locator('#toast').filter({hasText:'导入完成'}).waitFor({timeout:30000});
  };
  await drop({'text/html':`<img src="${origin}/image" alt="无外链图片">`,'text/uri-list':origin+'/image'});
  let state=JSON.parse(await fs.readFile(path.join(data,'library.json'),'utf8'));assert.equal(state.items[0].url,origin+'/image');assert.equal(state.items[0].hash,hash(image));assert.ok(!state.items[0].url.includes('undefined'));
  check('无外层链接的网页图片原件和来源地址正确');
  await page.locator('#new-folder').click();await page.locator('#folder-name').fill('网页拖入');await page.locator('#folder-form button[type=submit]').click();await page.locator('#view-title').filter({hasText:'网页拖入'}).waitFor();
  await drop({'DownloadURL':`audio/wav:音乐直链.wav:${origin}/audio.wav`});
  await page.locator('.asset-card').filter({hasText:'音乐直链'}).dblclick();await page.waitForFunction(()=>document.querySelector('audio')?.readyState>=2);
  await page.evaluate(async()=>{const a=document.querySelector('audio');a.muted=true;await a.play();});await page.waitForFunction(()=>document.querySelector('audio').currentTime>.15);await page.locator('#preview-close').click();
  check('Chrome DownloadURL 音乐直链拖到当前分类并实际播放');
  const before=await page.evaluate(()=>window.eagleOpen.summary().then(s=>s.total));
  await drop({'text/html':`<audio src="${origin}/audio.wav"></audio>`,'text/uri-list':origin+'/player'});
  state=JSON.parse(await fs.readFile(path.join(data,'library.json'),'utf8'));let track=state.items.find(i=>i.kind==='audio');assert.ok(state.overlays[track.id].urls.includes(origin+'/player'));assert.equal((await page.evaluate(()=>window.eagleOpen.summary())).total,before);
  check('HTML 音频控件保存页面来源且重复音乐不产生副本');
  await drop({'text/plain':origin+'/player'});assert.ok(requests.includes('/player'));
  check('拖入公开音频网页可提取 audio/source 文件并保留网页来源');
  await drop({'text/x-moz-url':origin+'/logo.svg\nFirefox SVG'});
  await page.locator('.asset-card').filter({hasText:'Firefox SVG'}).dblclick();await page.waitForFunction(()=>document.querySelector('#preview-body img')?.naturalWidth===320);await page.locator('#preview-close').click();check('Firefox URL 数据和 SVG 图片可拖入并完成解码');
  const inline='data:image/png;base64,'+image.toString('base64');
  await drop({'text/html':`<a href="${origin}/inline-page"><img src="${inline}" alt="内嵌图片"></a>`});
  state=JSON.parse(await fs.readFile(path.join(data,'library.json'),'utf8'));const picture=state.items.find(i=>i.hash===hash(image));assert.ok(state.overlays[picture.id].urls.includes(origin+'/inline-page'));assert.ok(!JSON.stringify(state).includes('data:image/png;base64,'));check('内嵌 data 图片拖入保持原字节且不把整个数据地址写入索引');
  await drop({'text/html':`<img src="blob:${origin}/virtual">`,'text/uri-list':origin+'/blob-page'},'#grid-scroll',{name:'临时浏览器图片.png',type:'image/png',bytes:[...image]});
  state=JSON.parse(await fs.readFile(path.join(data,'library.json'),'utf8'));assert.ok(state.overlays[picture.id].urls.includes(origin+'/blob-page'));check('没有磁盘路径的浏览器 File 可按原字节入库并保留网页来源');
  for(const route of ['/two-players','/hls','/login']){
    await page.locator('#toast').evaluate(el=>el.textContent='');await drop({'text/plain':origin+route});await page.locator('#import-report[open]').waitFor();assert.ok((await page.locator('#import-details').textContent()).length>10);await page.locator('[data-close="import-report"]').click();
  }
  check('多音频歧义、流媒体和登录页给出可见原因而不保存伪文件');
  await page.screenshot({path:path.join(verification,'web-drop-workflow.png')});
  const items=await page.evaluate(()=>window.eagleOpen.query({view:'local'}));assert.equal(items.total,3);
  for(const item of items.items){const disk=JSON.parse(await fs.readFile(path.join(data,'library.json'),'utf8')).items.find(i=>i.id===item.id);assert.equal(hash(await fs.readFile(disk.filePath)),disk.hash);assert.equal(item.folders.length,1);}
  await page.evaluate(()=>{for(const color of ['#ff0000','#0000ff']){const t=new DataTransfer();t.setData('text/html',`<img src="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="'+color+'"/></svg>')}">`);document.querySelector('#grid-scroll').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:t}));}});
  await page.waitForFunction(()=>document.querySelectorAll('.asset-card').length===5&&!document.querySelector('#import').disabled);check('连续快速拖入按队列保存，第二批未丢失');
  await page.evaluate(url=>{const t=new DataTransfer();t.setData('text/plain',url);document.querySelector('#grid-scroll').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:t}));},origin+'/slow.svg');
  await app.close();app=null;session=await launch();app=session.a;page=session.p;assert.equal(await page.locator('.asset-card').count(),6);check('导入途中退出会等待文件保存，重启后图片、音乐、SVG、来源与分类保持');
  assert.deepEqual(report.errors,[]);report.passed=true;report.sandbox=sandbox;report.completedAt=new Date().toISOString();
})().catch(e=>{report.error=e.stack;console.error(e);process.exitCode=1;}).finally(async()=>{if(app)await app.close().catch(()=>{});if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await fs.writeFile(path.join(verification,'web-drop-report.json'),JSON.stringify(report,null,2));});
