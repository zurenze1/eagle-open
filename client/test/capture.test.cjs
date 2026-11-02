const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { Library, hashFile } = require('../src/library.cjs');
const { captureMedia, downloadMedia } = require('../src/capture.cjs');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6sQAAAABJRU5ErkJggg==','base64');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eagle-capture-test-'));
  const requests = [];
  const server = http.createServer((req,res) => {
    requests.push({ url: req.url, referer: req.headers.referer });
    if(req.url === '/redirect') {res.writeHead(302,{Location:'/image'});res.end();}
    else if(req.url === '/bad-redirect') {res.writeHead(302,{Location:'file:///etc/passwd'});res.end();}
    else if(req.url === '/page' || req.url === '/fake.png') {res.writeHead(200,{'Content-Type':req.url === '/page'?'text/html':'image/png'});res.end('<html>Login required</html>');}
    else if(req.url === '/missing') {res.writeHead(404);res.end();}
    else if(req.url === '/hang') { /* Deliberate timeout. */ }
    else {res.writeHead(200,{'Content-Type':'image/png','Content-Disposition':'attachment; filename="../../inspiration.png"'});res.end(png);}
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});});
  return { root, url: 'http://127.0.0.1:'+server.address().port, requests, library: await new Library(path.join(root,'library')).init() };
}
test('Remote image saves verified original, provenance and classification; duplicate adds source and survives reopening',async t=>{
  const {root,url,library,requests}=await fixture(t),folder=await library.createFolder('网页灵感');
  const result=await captureMedia(library,[{url:url+'/redirect',sourceURL:url+'/article'}],folder.id);
  assert.equal(result.imported.length,1);assert.deepEqual(result.skipped,[]);
  const item=library.get(result.imported[0].id);assert.equal(item.url,url+'/article');assert.equal(item.downloadURL,url+'/redirect');assert.equal(item.resolvedURL,url+'/image');assert.deepEqual(item.folders,[folder.id]);assert.deepEqual(await fs.readFile(item.filePath),png);
  assert.ok(requests.every(r=>r.referer===url+'/article'));assert.equal(item.hash,await hashFile(item.filePath));assert.ok(item.filePath.startsWith(path.join(root,'library','assets')));
  const second=await library.createFolder('另一分类');const repeat=await captureMedia(library,[{url:url+'/image',sourceURL:url+'/other'}],second.id);assert.equal(repeat.duplicates.length,1);
  const reopened=await new Library(library.root).init();assert.equal(reopened.summary().total,1);assert.deepEqual(reopened.get(item.id).folders,[folder.id,second.id]);assert.deepEqual(reopened.get(item.id).urls,[url+'/article',url+'/other']);
  assert.deepEqual((await fs.readdir(root)).filter(n=>n.startsWith('.capture-')),[]);
});
test('Web pages, spoofed MIME, 404 and non-web redirects cannot become media records',async t=>{
  const {url,library}=await fixture(t);
  const result=await captureMedia(library,['/page','/fake.png','/missing','/bad-redirect'].map(p=>({url:url+p})),null);
  assert.equal(result.imported.length,0);assert.equal(result.skipped.length,4);assert.equal(library.summary().total,0);
  assert.match(result.skipped[0].reason,/网页/);assert.match(result.skipped[1].reason,/没有识别/);assert.match(result.skipped[2].reason,/404/);assert.match(result.skipped[3].reason,/http/);
});
test('Streaming limit and stalled network abort with no partial files or metadata',async t=>{
  const {root,url,library}=await fixture(t);
  const result=await captureMedia(library,[{url:url+'/image'}],null,()=>{},{maxBytes:20});assert.match(result.skipped[0].reason,/上限/);
  const dir=path.join(root,'timeout');await fs.mkdir(dir);
  await assert.rejects(downloadMedia({url:url+'/hang'},dir,()=>{},{timeoutMs:60}),/超时/);
  assert.deepEqual(await fs.readdir(dir),[]);assert.equal(library.summary().total,0);
});
test('Ratings, dynamic smart folders, folder moves and random paging persist without duplicate rows',async t=>{
  const {root,url,library}=await fixture(t);const a=await library.createFolder('上层'),b=await library.createFolder('子层',a.id);
  const result=await captureMedia(library,[{url:url+'/image'}],b.id);const id=result.imported[0].id;
  await library.edit([id],{rating:4,tags:['灵感']});const smart=await library.createSmartFolder('四星图片',{kind:'image',minRating:4,tag:'灵感'});
  assert.equal((await library.query({smartId:smart.id})).total,1);await library.edit([id],{rating:3});assert.equal((await library.query({smartId:smart.id})).total,0);
  await assert.rejects(library.editFolder(a.id,'上层',b.id),/自身|子文件夹/);await library.editFolder(b.id,'移动后的分类',null);
  await library.recordOpen(id);const reopened=await new Library(library.root).init();assert.equal((await reopened.query({view:'recent'})).total,1);assert.equal(reopened.summary().smartFolders.length,1);assert.equal(reopened.folders().find(f=>f.id===b.id).parentId,null);
  for(let i=0;i<6;i++){const file=path.join(root,`test${i}.txt`);await fs.writeFile(file,String(i));await reopened.importPaths([file]);}
  const first=await reopened.query({view:'random',randomSeed:42,limit:3}),second=await reopened.query({view:'random',randomSeed:42,offset:3,limit:4});assert.equal(new Set([...first.items,...second.items].map(i=>i.id)).size,7);
});
