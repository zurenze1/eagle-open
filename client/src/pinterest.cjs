// Public Pin metadata protocol verified against yt-dlp's Unlicense extractor.
// No browser cookies, browser storage or Eagle implementation is used.
function pinPage(value) {
  try {
    const u=new URL(value);
    if(!/^https?:$/.test(u.protocol)||u.username||u.password||!/(^|\.)pinterest\.(com|co\.uk|ca|fr|de|jp|com\.au|co\.kr|es|it|pt|com\.mx|ch|at|nl|be|se|dk|in|nz|ru|tw)$/.test(u.hostname))return null;
    const match=/^\/pin\/(?:[\w-]+--)?(\d+)(?:\/|$)/.exec(u.pathname);
    return match?{id:match[1],url:u.href}:null;
  }catch{return null;}
}
function choosePinMedia(data,input,page) {
  const groups=[];let hasVideo=false;
  const visit=(value,depth=0)=>{
    if(!value||typeof value!=='object'||depth>30)return;
    if(value.video_list&&typeof value.video_list==='object'){
      hasVideo=true;
      const formats=Object.values(value.video_list).filter(f=>f&&typeof f.url==='string'&&/^https?:\/\//.test(f.url)&&/\.mp4(?:\?|$)/i.test(f.url));
      formats.sort((a,b)=>(Number(b.width)||0)*(Number(b.height)||0)-(Number(a.width)||0)*(Number(a.height)||0));
      if(formats[0])groups.push(formats[0]);
    }
    for(const [key,child]of Object.entries(value))if(key!=='video_list')visit(child,depth+1);
  };
  // Only the selected Pin's own media, excluding related/recommended Pins.
  visit(data.videos);visit(data.story_pin_data?.pages);visit(data.carousel_data?.carousel_slots);
  const videos=[...new Map(groups.map(v=>[v.url,v])).values()];
  const token=/\/([a-f0-9]{32})(?:[._/]|$)/i.exec(new URL(input.url).pathname)?.[1];
  const matching=token?videos.filter(v=>v.url.includes(token)):[];
  if(videos.length){
    const selected=matching.length?matching:input.pageOnly?videos:[videos[0]];
    return selected.map((v,index)=>({url:v.url,sourceURL:page.url,name:input.name||data.title||data.grid_title||`网页视频 ${index+1}`,expectedKind:'video'}));
  }
  if(hasVideo||data.is_video===true||/\/videos\/thumbnails\//i.test(input.url)||input.expectedKind==='video')throw new Error('未解析到该视频的 MP4 原件；不会把封面当成视频保存');
  const image=data.images?.orig||Object.values(data.images||{}).sort((a,b)=>(b?.width||0)*(b?.height||0)-(a?.width||0)*(a?.height||0))[0];
  if(image?.url&&/^https?:\/\//.test(image.url))return [{url:image.url,sourceURL:page.url,name:input.name||data.title||data.grid_title||''}];
  if(!input.pageOnly)return [input];
  throw new Error('此 Pin 没有可下载的公开图片或 MP4 文件');
}
async function resolvePin(input,{fetcher=fetch,timeoutMs=20000}={},cache=new Map()) {
  const page=pinPage(input.sourceURL)||pinPage(input.url);
  if(!page||input.expectedKind==='video'&&/\.mp4(?:\?|$)/i.test(input.url))return [input];
  if(!cache.has(page.id))cache.set(page.id,(async()=>{
    const query=new URLSearchParams({data:JSON.stringify({options:{id:page.id,field_set_key:'detailed'}})});
    const response=await fetcher('https://www.pinterest.com/resource/PinResource/get/?'+query,{signal:AbortSignal.timeout(Math.min(timeoutMs,20000)),credentials:'omit',redirect:'error',headers:{'X-Pinterest-PWS-Handler':'www/[username].js','User-Agent':'Mozilla/5.0'}});
    if(!response.ok){await response.body?.cancel();throw new Error(`Pinterest 媒体解析失败（HTTP ${response.status}）`);}
    const chunks=[];let length=0;
    for await(const chunk of response.body){length+=chunk.length;if(length>8*1024*1024)throw new Error('Pinterest 媒体信息过大');chunks.push(chunk);}
    const data=JSON.parse(Buffer.concat(chunks).toString('utf8')).resource_response?.data;
    if(!data||String(data.id)!==page.id)throw new Error('Pinterest 未返回所拖 Pin 的公开媒体信息');
    return data;
  })());
  return choosePinMedia(await cache.get(page.id),input,page);
}
module.exports={pinPage,choosePinMedia,resolvePin};
