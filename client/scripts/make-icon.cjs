const {chromium}=require('playwright-core');
const fs=require('node:fs/promises');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
(async()=>{
  const root=path.resolve(__dirname,'../assets'),browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try{const page=await browser.newPage({viewport:{width:1024,height:1024},deviceScaleFactor:1});await page.setContent('<style>html,body{margin:0;background:transparent}</style>'+await fs.readFile(path.join(root,'icon.svg'),'utf8'));await page.screenshot({path:path.join(root,'icon.png'),omitBackground:true});}finally{await browser.close();}
  const set=path.join(root,'icon.iconset');await fs.mkdir(set,{recursive:true});
  for(const n of [16,32,128,256,512])for(const scale of [1,2])execFileSync('sips',['-z',String(n*scale),String(n*scale),path.join(root,'icon.png'),'--out',path.join(set,`icon_${n}x${n}${scale===2?'@2x':''}.png`)],{stdio:'ignore'});
  execFileSync('iconutil',['-c','icns',set,'-o',path.join(root,'icon.icns')]);
})().catch(e=>{console.error(e);process.exit(1);});
