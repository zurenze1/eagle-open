const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {Library,hashFile}=require('../src/library.cjs'),{captureMedia}=require('../src/capture.cjs');
async function setup(t){
 const root=await fs.mkdtemp(path.resolve(__dirname,'../../verification/video-contract-')),video=await fs.readFile(path.resolve(__dirname,'../../verification/fixtures/视频预览测试.mp4')),requests=[];
 const server=http.createServer((req,res)=>{requests.push(req.url);if(req.url==='/player'){res.setHeader('Content-Type','text/html');res.end('<meta property="og:video" content="/one.mp4"><meta property="og:title" content="网页视频">');}else if(req.url==='/fake.mp4'){res.setHeader('Content-Type','image/png');res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6sQAAAABJRU5ErkJggg==','base64'));}else{res.setHeader('Content-Type','video/mp4');res.end(video);}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});return {root,video,requests,origin:'http://127.0.0.1:'+server.address().port,library:await new Library(path.join(root,'data')).init()};
}
test('Pinterest carousel posters resolve matching MP4 originals, never JPEGs; metadata requested once per batch',async t=>{
 const {origin,library,video,requests}=await setup(t),sourceURL='https://www.pinterest.com/pin/123456789/';let apiCalls=0;
 const data={id:'123456789',carousel_data:{carousel_slots:['a','b'].map((c,index)=>({videos:{video_list:{HLS:{url:origin+'/hls.m3u8',width:2000,height:2000},MP4:{url:origin+'/'+c.repeat(32)+'.mp4',width:720,height:960}}}}))},related:{videos:{video_list:{MP4:{url:origin+'/unrelated.mp4'}}}}};
 const fetcher=async(url,options)=>{if(url.startsWith('https://www.pinterest.com/resource/')){apiCalls++;assert.equal(options.credentials,'omit');return new Response(JSON.stringify({resource_response:{data}}));}return fetch(url,options);};
 const result=await captureMedia(library,['a','b'].map(c=>({url:'https://i.pinimg.com/videos/thumbnails/originals/'+c.repeat(32)+'.0000000.jpg',sourceURL})),null,()=>{},{fetcher});
 assert.equal(apiCalls,1);assert.equal(result.imported.length,1);assert.equal(result.duplicates.length,1);assert.deepEqual(result.skipped,[]);assert.equal(requests.length,2);assert.ok(requests.every(url=>url.endsWith('.mp4')&&!url.includes('unrelated')));
 const item=library.get(result.imported[0].id);assert.equal(item.kind,'video');assert.equal(item.ext,'mp4');assert.equal(item.url,sourceURL);assert.equal(item.hash,await hashFile(item.filePath));assert.deepEqual(await fs.readFile(item.filePath),video);
 const reopened=await new Library(library.root).init();assert.equal(reopened.get(item.id).kind,'video');
});
test('An unavailable video or wrong Pin response cannot silently become a still image',async t=>{
 const {origin,library}=await setup(t),url='https://www.pinterest.com/pin/123456789/';
 const fetcher=async()=>new Response(JSON.stringify({resource_response:{data:{id:'123456789',is_video:true,videos:{video_list:{HLS:{url:origin+'/hls.m3u8'}}},images:{orig:{url:origin+'/cover.jpg'}}}}}));
 const failed=await captureMedia(library,[{url:'https://i.pinimg.com/videos/thumbnails/originals/'+ 'a'.repeat(32)+'.jpg',sourceURL:url}],null,()=>{},{fetcher});assert.equal(failed.imported.length,0);assert.match(failed.skipped[0].reason,/MP4/);
 const mismatch=await captureMedia(library,[{url,pageOnly:true}],null,()=>{},{fetcher:async()=>new Response(JSON.stringify({resource_response:{data:{id:'999'}}}))});assert.equal(mismatch.imported.length,0);assert.match(mismatch.skipped[0].reason,/所拖 Pin/);
 assert.equal(library.items().length,0);
});
test('Public OG video imports a playable container, but an image returned for a video URL is rejected',async t=>{
 const {origin,library}=await setup(t);const good=await captureMedia(library,[{url:origin+'/player',pageOnly:true}]);assert.equal(good.imported.length,1);assert.equal(library.get(good.imported[0].id).kind,'video');
 const bad=await captureMedia(library,[{url:origin+'/fake.mp4',expectedKind:'video'}]);assert.equal(bad.imported.length,0);assert.match(bad.skipped[0].reason,/封面/);
});
