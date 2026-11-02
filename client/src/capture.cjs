// Independent media collector. No Eagle implementation or resources are included.
const fs = require('node:fs/promises');
const path = require('node:path');
const { kindOf } = require('./library.cjs');

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
async function downloadMedia(input, directory, onProgress = () => {}, { fetcher = fetch, maxBytes = 512 * 1024 * 1024, timeoutMs = 120000 } = {}) {
  const url = webURL(input.url), sourceURL = input.sourceURL ? webURL(input.sourceURL) : url;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  let response, handle, bytes = 0;
  const temp = path.join(directory, 'download.part');
  try {
    let target = url;
    for (let redirect = 0; redirect <= 8; redirect++) {
      response = await fetcher(target, { signal: controller.signal, redirect: 'manual', credentials: 'omit',
        headers: { 'User-Agent': 'EagleOpen/0.2', ...(input.sourceURL ? { Referer: sourceURL } : {}) } });
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.get('location'); await response.body?.cancel();
        if (!location || redirect === 8) throw new Error('链接重定向过多或地址缺失');
        target = webURL(new URL(location, target).href); continue;
      }
      break;
    }
    if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}），请检查链接是否可直接下载`);
    if (/text\/html|application\/(?:xhtml\+xml|vnd.apple.mpegurl|x-mpegurl)|audio\/x-mpegurl/i.test(response.headers.get('content-type') || '')) {
      throw new Error('这是网页、登录页或流媒体播放列表。请拖入图片本身，或使用音视频文件直链');
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
    const { fileTypeFromFile } = await import('file-type');
    let type; try { type = await fileTypeFromFile(temp); } catch { /* Unsupported/malformed signatures stay unknown. */ }
    if (!type || (kindOf(type.ext) === 'file' && type.ext !== 'pdf')) {
      throw new Error('没有识别到可导入的图片、音视频、字体或 PDF 文件；该链接可能返回网页');
    }
    const finalURL = webURL(response.url || target);
    const file = path.join(directory, fileName(input.name || responseName(response.headers, finalURL), type.ext));
    await fs.rename(temp, file);
    return { file, metadata: { url: sourceURL, downloadURL: url, resolvedURL: finalURL, sourceName: '网页采集' }, bytes, mime: type.mime };
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') throw new Error('下载超时，请检查网络或换用文件直链');
    throw error;
  } finally { clearTimeout(timer); await handle?.close(); await fs.rm(temp, { force: true }); }
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
module.exports = { webURL, downloadMedia, captureMedia, fileName };
