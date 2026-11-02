// Independent media collector. No Eagle implementation or resources are included.
const fs = require('node:fs/promises');
const path = require('node:path');
const { kindOf } = require('./library.cjs');
const VIRTUAL_LIMIT = 32 * 1024 * 1024;

function webURL(value) {
  if (typeof value !== 'string' || value.length > 16384) throw new Error('链接格式不正确');
  let url; try { url = new URL(value); } catch { throw new Error('请输入完整的 http 或 https 链接'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('仅支持不含账号密码的 http 或 https 链接');
  return url.href;
}
function fileName(value, ext) {
  let name = String(value || '网页素材').replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '_').trim();
  name = path.basename(name, path.extname(name)).replace(/^\.+/, '').slice(0, 150) || '网页素材';
  const characters = Array.from(name);
  while (Buffer.byteLength(characters.join(''), 'utf8') > 180) characters.pop();
  name = characters.join('');
  return name + '.' + ext;
}
function responseName(headers, url) {
  const disposition = headers.get('content-disposition') || '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const plain = /filename="([^"]+)"|filename=([^;]+)/i.exec(disposition);
  try { return encoded ? decodeURIComponent(encoded[1]) : plain ? plain[1] || plain[2] : decodeURIComponent(new URL(url).pathname.split('/').pop()); }
  catch { return '网页素材'; }
}
async function mediaType(file) {
  const { fileTypeFromFile } = await import('file-type');
  let type; try { type = await fileTypeFromFile(file); } catch { /* Unknown signatures require an explicit supported text format. */ }
  if (!type && (await fs.stat(file)).size <= 8 * 1024 * 1024) {
    const text = await fs.readFile(file, 'utf8');
    // SVG is a text format; check its actual XML root. It is previewed only as an image.
    const root = text.replace(/^\uFEFF/, '').replace(/^\s*(?:<\?xml[^>]*\?>\s*|<!--[\s\S]*?-->\s*)*/i, '');
    if (/^<svg(?:\s|>)/i.test(root) && !/<!DOCTYPE|<!ENTITY|<script\b|<foreignObject\b|\son\w+\s*=/i.test(text)) type = { ext: 'svg', mime: 'image/svg+xml' };
  }
  if (!type || (kindOf(type.ext) === 'file' && type.ext !== 'pdf')) throw new Error('没有识别到可导入的图片、音视频、字体或 PDF 文件；该链接可能返回网页');
  return type;
}
function sourceMetadata(input, resolvedURL) {
  const sourceURL = input.sourceURL ? webURL(input.sourceURL) : (/^https?:/i.test(input.url || '') ? webURL(input.url) : '');
  return { url: sourceURL, downloadURL: !input.pageOnly && /^https?:/i.test(input.url || '') ? webURL(input.url) : '', resolvedURL: /^https?:/i.test(resolvedURL || '') ? webURL(resolvedURL) : '', sourceName: '网页采集' };
}
function percentBytes(value) {
  const encoded=Buffer.from(value,'utf8'),out=Buffer.allocUnsafe(Math.min(encoded.length,VIRTUAL_LIMIT));let length=0;
  const hex=c=>c>=48&&c<=57?c-48:(c|32)>=97&&(c|32)<=102?(c|32)-87:-1;
  for(let i=0;i<encoded.length;i++){
    let byte=encoded[i];
    if(byte===37){const a=hex(encoded[++i]),b=hex(encoded[++i]);if(a<0||b<0)throw new Error('内嵌图片编码无法读取');byte=a*16+b;}
    if(length===VIRTUAL_LIMIT)throw new Error('内嵌图片超过 32 MB');out[length++]=byte;
  }
  return out.subarray(0,length);
}
async function writeMediaBytes(input, directory) {
  const bytes = input.bytes;
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > VIRTUAL_LIMIT) throw new Error('浏览器临时素材需在 32 MB 以内；较大文件请拖入下载直链或先保存文件');
  const temp = path.join(directory, 'buffer.part');
  await fs.writeFile(temp, bytes, { flag: 'wx' });
  const type = await mediaType(temp), file = path.join(directory, fileName(input.name, type.ext));
  await fs.rename(temp, file);
  return { file, metadata: sourceMetadata(input), bytes: bytes.length, mime: type.mime };
}
function pageAudio(html, url) {
  const { load } = require('cheerio');
  const $ = load(html);
  let base=url;try{if($('base[href]').attr('href'))base=webURL(new URL($('base[href]').attr('href'),url).href);}catch{}
  const normalize = raw => { if (!raw?.trim()) return null; try { return webURL(new URL(raw,base).href); } catch { return null; } };
  const title = $('meta[property="og:title"]').attr('content') || $('title').text().trim();
  const declared = $('meta[property="og:audio:secure_url"],meta[property="og:audio:url"],meta[property="og:audio"]').toArray().map(el=>normalize($(el).attr('content'))).find(Boolean);
  if (declared) return { url: declared, name: title };
  const players = $('audio').toArray().map(el=>normalize($(el).attr('src')) || $(el).find('source[src]').toArray().map(source=>normalize($(source).attr('src'))).find(Boolean)).filter(Boolean);
  const unique = [...new Set(players)];
  if (unique.length === 1) return { url: unique[0], name: title };
  if (unique.length > 1) throw new Error('页面中有多段音频，请拖入具体音频控件或文件链接');
  throw new Error('此网页没有可直接下载的公开音频。请拖图片本身、音乐文件链接或已下载文件');
}
async function downloadMedia(input, directory, onProgress = () => {}, { fetcher = fetch, maxBytes = 512 * 1024 * 1024, timeoutMs = 120000 } = {}) {
  const startedAt=Date.now();
  if (/^data:image\//i.test(input.url || '')) {
    if (input.url.length > VIRTUAL_LIMIT * 3) throw new Error('内嵌图片超过 32 MB');
    const match = /^data:image\/[a-z0-9.+-]+((?:;[^,]*)?),(.*)$/is.exec(input.url);
    if (!match) throw new Error('内嵌图片编码暂不支持，请先保存为文件');
    let bytes;
    try {if(/;base64(?:;|$)/i.test(match[1])){const value=match[2].replace(/\s/g,'');if(!/^[a-z0-9+/]*={0,2}$/i.test(value)||value.length%4===1||(value.includes('=')&&value.length%4))throw new Error();bytes=Buffer.from(value,'base64');}else bytes=percentBytes(match[2]);}
    catch {throw new Error('内嵌图片编码无法读取，请先保存为文件');}
    return writeMediaBytes({ ...input, bytes }, directory);
  }
  const url = webURL(input.url), sourceURL = input.sourceURL ? webURL(input.sourceURL) : url;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  let response, handle, bytes = 0;
  const temp = path.join(directory, 'download.part');
  try {
    let target = url;
    for (let redirect = 0; redirect <= 8; redirect++) {
      response = await fetcher(target, { signal: controller.signal, redirect: 'manual', credentials: 'omit',
        headers: { 'User-Agent': 'EagleOpen/0.3', ...(input.sourceURL ? { Referer: sourceURL } : {}) } });
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.get('location'); await response.body?.cancel();
        if (!location || redirect === 8) throw new Error('链接重定向过多或地址缺失');
        target = webURL(new URL(location, target).href); continue;
      }
      break;
    }
    if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}），请检查链接是否可直接下载`);
    if (/text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type') || '')) {
      if (input.pageResolved) throw new Error('音频地址仍返回网页，可能需要登录；请使用文件直链');
      const chunks=[];let length=0;
      for await (const chunk of response.body) { length+=chunk.length; if(length>2*1024*1024)throw new Error('网页过大，请拖具体媒体链接');chunks.push(chunk); }
      const pageURL=webURL(response.url||target), audio=pageAudio(Buffer.concat(chunks).toString('utf8'),pageURL);
      return await downloadMedia({ ...audio, name: input.name || audio.name, sourceURL:input.sourceURL||pageURL,pageResolved:true },directory,onProgress,{fetcher,maxBytes,timeoutMs:Math.max(1,timeoutMs-(Date.now()-startedAt))});
    }
    if (/application\/(?:vnd.apple.mpegurl|x-mpegurl)|audio\/x-mpegurl/i.test(response.headers.get('content-type') || '')) {
      throw new Error('这是流媒体播放列表，请使用可下载的音乐或视频文件链接');
    }
    const total = Number(response.headers.get('content-length')) || 0;
    if (total > maxBytes) throw new Error('文件超过单次采集上限（512 MB）');
    if (!response.body) throw new Error('链接没有返回文件内容');
    handle = await fs.open(temp, 'wx');
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > maxBytes) { controller.abort(); throw new Error('文件超过单次采集上限（512 MB）'); }
      await handle.writeFile(chunk); onProgress({ bytes, totalBytes: total });
    }
    await handle.close(); handle = null;
    if (!bytes) throw new Error('下载到的文件为空');
    const type = await mediaType(temp);
    const finalURL = webURL(response.url || target);
    const file = path.join(directory, fileName(input.name || responseName(response.headers, finalURL), type.ext));
    await fs.rename(temp, file);
    return { file, metadata: { url: sourceURL, downloadURL: url, resolvedURL: finalURL, sourceName: '网页采集' }, bytes, mime: type.mime };
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') throw new Error('下载超时，请检查网络或换用文件直链');
    throw error;
  } finally { clearTimeout(timer); controller.abort();await handle?.close(); await fs.rm(temp, { force: true }); }
}
async function importMediaBytes(library,input,folderId) {
  const directory=await fs.mkdtemp(path.join(path.dirname(library.root),'.capture-'));
  try { const media=await writeMediaBytes(input,directory),file=await fs.realpath(media.file);return await library.importPaths([file],folderId,()=>{},{[file]:media.metadata}); }
  finally { await fs.rm(directory,{recursive:true,force:true}); }
}
async function captureMedia(library, inputs, folderId, onProgress = () => {}, options = {}) {
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 100) throw new Error('一次可采集 1–100 个媒体链接');
  const result = { imported: [], duplicates: [], skipped: [] };
  for (let index = 0; index < inputs.length; index++) {
    const directory = await fs.mkdtemp(path.join(path.dirname(library.root), '.capture-'));
    try {
      const media = await downloadMedia(inputs[index], directory, progress => onProgress({ completed: index, total: inputs.length, phase: 'download', ...progress }), options);
      const file = await fs.realpath(media.file);
      const saved = await library.importPaths([file], folderId, () => {}, { [file]: media.metadata });
      for (const key of ['imported','duplicates','skipped']) result[key].push(...saved[key]);
    } catch (error) { result.skipped.push({ name: `链接 ${index + 1}`, reason: error.message }); }
    finally { await fs.rm(directory, { recursive: true, force: true }); }
    onProgress({ completed: index + 1, total: inputs.length, phase: 'download' });
  }
  return result;
}
module.exports = { webURL, downloadMedia, captureMedia, importMediaBytes, mediaType, sourceMetadata, fileName };
