const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const mimeTypes = { png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',avif:'image/avif',svg:'image/svg+xml',bmp:'image/bmp',mp4:'video/mp4',m4v:'video/mp4',mov:'video/quicktime',webm:'video/webm',mp3:'audio/mpeg',wav:'audio/wav',m4a:'audio/mp4',aac:'audio/aac',ogg:'audio/ogg',flac:'audio/flac',ttf:'font/ttf',otf:'font/otf',woff:'font/woff',woff2:'font/woff2',ttc:'font/collection',pdf:'application/pdf' };
// Chromium 通过 Range 请求跳转音视频；必须返回正确的 206 与 Content-Range。
async function mediaResponse(file, request) {
  const stat=await fsp.stat(file),size=stat.size;
  const headers=new Headers({'Content-Type':mimeTypes[path.extname(file).slice(1).toLowerCase()]||'application/octet-stream','Accept-Ranges':'bytes','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'app://ui'});
  let start=0,end=size-1,status=200;
  const range=request.headers.get('range');
  if(range){
    const match=/^bytes=(\d*)-(\d*)$/.exec(range);
    if(!match||(!match[1]&&!match[2]))return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
    if(!match[1]){const suffix=Number(match[2]);start=Math.max(0,size-suffix);}
    else{start=Number(match[1]);if(match[2])end=Math.min(Number(match[2]),size-1);}
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=size)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
    status=206;headers.set('Content-Range',`bytes ${start}-${end}/${size}`);
  }
  headers.set('Content-Length',String(Math.max(0,end-start+1)));
  if(request.method==='HEAD'||size===0)return new Response(null,{status,headers});
  return new Response(Readable.toWeb(fs.createReadStream(file,{start,end})),{status,headers});
}
module.exports={mediaResponse};
