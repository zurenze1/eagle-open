const {_electron}=require('playwright-core');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const verification=path.resolve(__dirname,'../../verification'),binary=path.resolve(__dirname,'../../dist/Eagle 开源.app/Contents/MacOS/Eagle Open');
(async()=>{
  const data=await fs.mkdtemp(path.join(verification,'packaged-')),env={...process.env,EAGLE_OPEN_DATA:data,EAGLE_OPEN_NO_SOURCE:'1'};delete env.ELECTRON_RUN_AS_NODE;
  const report={binary,checks:[],passed:false};let app;
  try{
    app=await _electron.launch({executablePath:binary,args:[],env});let page=await app.firstWindow();await page.locator('#library-subtitle').filter({hasText:'份素材'}).waitFor();
    const info=await app.evaluate(({app})=>({packaged:app.isPackaged,version:app.getVersion(),userData:app.getPath('userData')}));assert.equal(info.packaged,true);assert.equal(info.version,'0.1.0');report.info=info;report.checks.push('打包应用真实启动');
    const files=['图片预览测试.png','视频预览测试.mp4','音频预览测试.wav'].map(f=>path.join(verification,'fixtures',f));
    await app.evaluate(({dialog},filePaths)=>dialog.showOpenDialog=async()=>({canceled:false,filePaths}),files);await page.locator('#import').click();await page.locator('#toast').filter({hasText:'3 份新增'}).waitFor();assert.equal(await page.locator('.asset-card').count(),3);report.checks.push('成品真实导入三类文件');
    await page.locator('.asset-card').filter({hasText:'视频预览测试'}).dblclick();await page.waitForFunction(()=>{const v=document.querySelector('video');return v?.readyState>=2&&v.duration===3;},null,{polling:100});await page.evaluate(async()=>{const v=document.querySelector('video');v.muted=true;await v.play();});await page.waitForFunction(()=>document.querySelector('video').currentTime>.2,null,{polling:100});await page.locator('#preview-close').click();report.checks.push('成品视频实际播放');
    await page.screenshot({path:path.join(verification,'packaged-workflow.png')});await app.close();app=null;
    app=await _electron.launch({executablePath:binary,args:[],env});page=await app.firstWindow();await page.locator('#library-subtitle').filter({hasText:'3 份素材'}).waitFor();assert.equal(await page.locator('.asset-card').count(),3);report.checks.push('成品退出重启后素材保持');
    const layout=await page.evaluate(()=>({body:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,inspector:document.querySelector('#inspector').getBoundingClientRect().right}));assert.ok(layout.scroll<=layout.body);assert.ok(layout.inspector<=layout.body+1);report.layout=layout;report.checks.push('三栏在本机窗口完整显示');
    report.passed=true;report.completedAt=new Date().toISOString();console.log(JSON.stringify(report,null,2));
  }catch(e){report.error=e.stack;throw e;}finally{if(app)await app.close();await fs.writeFile(path.join(verification,'packaged-test-report.json'),JSON.stringify(report,null,2));}
})().catch(e=>{console.error(e);process.exitCode=1;});
