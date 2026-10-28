const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../../verification/fixtures');fs.mkdirSync(root,{recursive:true});
const ffmpeg=process.env.FFMPEG_PATH||'ffmpeg';
for(const [name,args] of [
  ['视频预览测试.mp4',['-f','lavfi','-i','testsrc2=size=640x360:rate=24:duration=3','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart']],
  ['音频预览测试.wav',['-f','lavfi','-i','sine=frequency=440:duration=3','-c:a','pcm_s16le']],
  ['图片预览测试.png',['-f','lavfi','-i','color=c=0x42698c:s=720x480:d=1','-frames:v','1']],
])execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-y',...args,path.join(root,name)]);
