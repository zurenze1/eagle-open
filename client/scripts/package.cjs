const { packager } = require('@electron/packager');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
(async()=>{
  const root=path.resolve(__dirname,'..'), project=path.resolve(root,'..');
  // 成品即使移动到 Applications，仍使用已确认项目中的独立库。
  await fs.writeFile(path.join(root,'workspace.json'),JSON.stringify({projectRoot:project},null,2));
  const built=await packager({dir:root,out:path.join(project,'build'),name:'Eagle 开源',executableName:'Eagle Open',appBundleId:'local.zurenze.eagle-open',appVersion:'0.1.0',buildVersion:'1',platform:'darwin',arch:'arm64',overwrite:true,prune:true,asar:false,icon:path.join(root,'assets/icon.icns'),
    ignore:[/^\/test($|\/)/,/^\/scripts($|\/)/],
    extendInfo:{CFBundleDisplayName:'Eagle 开源',CFBundleName:'Eagle 开源',NSHumanReadableCopyright:'Independent asset manager. Includes MIT TagSpaces modules, Electron, Fuse.js and Lucide.'}});
  const dist=path.join(project,'dist');await fs.mkdir(dist,{recursive:true});
  const target=path.join(dist,'Eagle 开源.app');await fs.rm(target,{recursive:true,force:true});
  await fs.rename(path.join(built[0],'Eagle 开源.app'),target);
  execFileSync('/usr/libexec/PlistBuddy',['-c','Set :CFBundleDisplayName Eagle 开源',path.join(target,'Contents/Info.plist')]);
  execFileSync('codesign',['--force','--deep','--sign','-',target]);
  console.log(target);
})().catch(e=>{console.error(e);process.exit(1);});
