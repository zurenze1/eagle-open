const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Library, hashFile } = require('../src/library.cjs');
const { mediaResponse } = require('../src/media.cjs');
const base = path.resolve(__dirname, '../../verification/sandboxes');
async function fixture(t) {
  await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'library-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const source=path.join(root,'source.library');await fs.mkdir(path.join(source,'images'),{recursive:true});
  await fs.writeFile(path.join(source,'metadata.json'),JSON.stringify({folders:[{id:'parent',name:'人物故事',children:[{id:'child',name:'电影截图',children:[]}]},{id:'protected',name:'私密文件夹',password:'locked',children:[]}]}));
  for(const m of [
    {id:'one',name:'山川与灵感',tags:['自然','Photo'],folders:['child'],annotation:'远山与日落',ext:'png'},
    {id:'two',name:'Deleted',folders:[],isDeleted:true,ext:'png'},
    {id:'three',name:'Protected',folders:['protected'],ext:'png'},
  ]){
    const dir=path.join(source,'images',m.id+'.info');await fs.mkdir(dir);
    await fs.writeFile(path.join(dir,m.name+'.png'),'original fixture '+m.id);
    await fs.writeFile(path.join(dir,'metadata.json'),JSON.stringify({...m,size:100,btime:1000,mtime:1000}));
  }
  return {root,source,library:await new Library(path.join(root,'data')).init(source)};
}
test('Eagle only indexes active accessible records; overlay changes persist without changing originals',async t=>{
  const {root,source,library}=await fixture(t);const sourceMeta=path.join(source,'metadata.json'),itemMeta=path.join(source,'images/one.info/metadata.json'),original=path.join(source,'images/one.info/山川与灵感.png');
  const before=await Promise.all([hashFile(sourceMeta),hashFile(itemMeta),hashFile(original)]);
  assert.equal(library.summary().total,1);assert.equal(library.summary().folders.length,2);
  const item=(await library.query()).items[0];
  await library.edit([item.id],{name:'改名不改原件',annotation:'本地描述',tags:['收藏','收藏'],folders:[]});
  assert.deepEqual(library.get(item.id).tags,['收藏']);
  assert.equal(await library.assetPath(item.id,'original'),original);
  const reopened=await new Library(path.join(root,'data')).init(source);
  assert.equal(reopened.get(item.id).name,'改名不改原件');assert.equal(reopened.get(item.id).annotation,'本地描述');assert.deepEqual(reopened.get(item.id).folders,[]);
  assert.deepEqual(await Promise.all([hashFile(sourceMeta),hashFile(itemMeta),hashFile(original)]),before);
});
test('Chinese search, case-insensitive tag filter, type filter and parent-folder scope combine correctly',async t=>{
  const {library}=await fixture(t),parent=library.folders().find(f=>f.name==='人物故事');
  assert.equal((await library.query({folderId:parent.id,text:'山川',kind:'image',tag:'photo'})).total,1);
  assert.equal((await library.query({text:'远山'})).total,1);
  assert.equal((await library.query({text:'山'})).total,1);
  assert.equal((await library.query({text:'不存在的词'})).total,0);
  assert.equal((await library.query({folderId:parent.id,kind:'audio'})).total,0);
  assert.equal(library.summary().folders.find(f=>f.id===parent.id).count,1);
});
test('Import copies and verifies contents, preserves nested folders, deduplicates and adds target category',async t=>{
  const {root,library}=await fixture(t),input=path.join(root,'input');await fs.mkdir(path.join(input,'nested'),{recursive:true});
  const file=path.join(input,'nested','测试 素材 #1.txt');await fs.writeFile(file,'unique media bytes');const originalHash=await hashFile(file);
  const folder=await library.createFolder('本轮导入');const progress=[];
  const result=await library.importPaths([input],folder.id,p=>progress.push(p));assert.equal(result.imported.length,1);
  const item=library.get(result.imported[0].id);assert.notEqual(item.filePath,file);assert.equal(await hashFile(item.filePath),originalHash);assert.equal(await hashFile(file),originalHash);
  assert.equal((await library.query({folderId:folder.id})).total,1);assert.equal(progress.at(-1).completed,1);
  const again=await library.importPaths([file],folder.id);assert.equal(again.imported.length,0);assert.equal(again.duplicates.length,1);
  assert.equal((await library.query({view:'local'})).total,1);assert.ok(library.get(item.id).folders.includes(folder.id));
});
test('Concurrent edits serialize, invalid batch rolls back and trash is reversible after reopening',async t=>{
  const {root,source,library}=await fixture(t),item=(await library.query()).items[0];
  await Promise.all([library.edit([item.id],{name:'并发名称'}),library.edit([item.id],{tags:['并发标签']})]);
  assert.equal(library.get(item.id).name,'并发名称');assert.deepEqual(library.get(item.id).tags,['并发标签']);
  await assert.rejects(library.edit([item.id,'missing'],{name:'不可留下'}));assert.equal(library.get(item.id).name,'并发名称');
  await library.edit([item.id],{deleted:true});assert.equal((await library.query()).total,0);assert.equal((await library.query({view:'trash'})).total,1);
  const reopened=await new Library(path.join(root,'data')).init(source);assert.equal(reopened.summary().trash,1);
  await reopened.edit([item.id],{deleted:false});assert.equal(reopened.summary().total,1);
});
test('Asset resolver rejects symlink escapes and malicious metadata is skipped',async t=>{
  const {root,source,library}=await fixture(t),file=path.join(root,'outside.txt');await fs.writeFile(file,'outside data');
  const dir=path.join(source,'images/evil.info');await fs.mkdir(dir);await fs.symlink(file,path.join(dir,'evil.txt'));
  await fs.writeFile(path.join(dir,'metadata.json'),JSON.stringify({id:'evil',name:'evil',ext:'txt',folders:[]}));
  await library.refresh();assert.equal(library.summary().total,1);
  const local=(await library.importPaths([file])).imported[0],asset=library.get(local.id).filePath;
  await fs.unlink(asset);await fs.symlink(file,asset);await assert.rejects(library.assetPath(local.id,'original'),/超出素材目录/);
});
test('Corrupt independent index recovers a valid backup and preserves damaged file',async t=>{
  const {root,library}=await fixture(t);await library.createFolder('备份前的分类');await library.savePreferences({thumbSize:210});
  await fs.writeFile(library.file,'{broken');const recovered=await new Library(path.join(root,'data')).init();
  assert.ok(recovered.folders().some(f=>f.name==='备份前的分类'));assert.ok(recovered.warnings.some(w=>w.includes('索引损坏')));
  assert.ok((await fs.readdir(path.join(root,'data'))).some(f=>f.startsWith('library.json.damaged-')));
});
test('Invalid fields and self-import fail without modifying independent metadata',async t=>{
  const {library}=await fixture(t),item=(await library.query()).items[0];const before=await hashFile(library.file);
  await assert.rejects(library.edit([item.id],{name:''}));await assert.rejects(library.edit([item.id],{folders:['missing']}));
  await assert.rejects(library.createFolder('x','missing'));assert.equal(await hashFile(library.file),before);
  const result=await library.importPaths([library.root]);assert.equal(result.imported.length,0);assert.equal(result.skipped.length,1);
});
test('Media streaming returns real byte ranges, suffixes, HEAD and rejects invalid ranges',async t=>{
  const {root}=await fixture(t),file=path.join(root,'sample.mp4');await fs.writeFile(file,'0123456789');
  const full=await mediaResponse(file,new Request('https://fixture'));assert.equal(full.status,200);assert.equal(full.headers.get('content-type'),'video/mp4');assert.equal(await full.text(),'0123456789');
  const partial=await mediaResponse(file,new Request('https://fixture',{headers:{Range:'bytes=3-6'}}));assert.equal(partial.status,206);assert.equal(partial.headers.get('content-range'),'bytes 3-6/10');assert.equal(await partial.text(),'3456');
  const suffix=await mediaResponse(file,new Request('https://fixture',{headers:{Range:'bytes=-3'}}));assert.equal(await suffix.text(),'789');
  const head=await mediaResponse(file,new Request('https://fixture',{method:'HEAD'}));assert.equal(head.headers.get('content-length'),'10');assert.equal(await head.text(),'');
  assert.equal((await mediaResponse(file,new Request('https://fixture',{headers:{Range:'bytes=20-'}}))).status,416);
});
