const fs=require('node:fs/promises');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);
(async()=>{
  if(process.platform!=='darwin')return;
  const root=path.resolve(__dirname,'..'),source=path.join(__dirname,'drag-watch.m'),target=path.join(root,'assets/drag-watch');
  try{if((await fs.stat(target)).mtimeMs>=Math.max((await fs.stat(source)).mtimeMs,(await fs.stat(__filename)).mtimeMs))return;}catch{}
  const selected=(await run('xcrun',['--sdk','macosx','--show-sdk-path'])).stdout.trim();
  const sdk=await fs.realpath(path.join(path.dirname(selected),'MacOSX.sdk')).catch(()=>selected);
  await run('xcrun',['clang','-arch','arm64','-fobjc-arc','-O2','-mmacosx-version-min=13.0','-isysroot',sdk,'-framework','AppKit',source,'-o',target],{timeout:120000});
  await run('codesign',['--force','--sign','-',target]);
  console.log('macOS 拖拽检测器已编译');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
