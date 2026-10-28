const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const Fuse = require('fuse.js');
const { extractFileExtension } = require('./vendor/tagspaces-paths.cjs');
const { filterByTags } = require('./vendor/tagspaces-filters.cjs');

const TYPES = {
  image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'svg', 'tif', 'tiff', 'heic'],
  video: ['mp4', 'mov', 'webm', 'm4v', 'mkv', 'avi'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'aiff'],
  font: ['ttf', 'otf', 'woff', 'woff2', 'ttc'],
};
const kindOf = ext => Object.keys(TYPES).find(k => TYPES[k].includes(ext.toLowerCase())) || 'file';
const unique = values => [...new Set(values)];
const inside = (root, file) => file === root || file.startsWith(root + path.sep);
const cleanText = (value, max = 1000) => {
  if (typeof value !== 'string' || value.length > max) throw new Error('文字格式不正确或过长');
  return value.trim();
};
async function hashFile(file) {
  const handle = await fs.open(file, 'r');
  try {
    const hash = crypto.createHash('sha256');
    for await (const chunk of handle.createReadStream()) hash.update(chunk);
    return hash.digest('hex');
  } finally { await handle.close(); }
}
async function safeFile(root, file) {
  const [r, f] = await Promise.all([fs.realpath(root), fs.realpath(file)]);
  if (!inside(r, f)) throw new Error('文件路径超出素材目录');
  return f;
}

class Library {
  constructor(root, { thumbnailer = async () => null } = {}) {
    this.root = path.resolve(root);
    this.file = path.join(this.root, 'library.json');
    this.thumbnailer = thumbnailer;
    this.sourceItems = [];
    this.sourceFolders = [];
    this.warnings = [];
    this.queue = Promise.resolve();
  }
  async init(defaultSource) {
    await fs.mkdir(path.join(this.root, 'assets'), { recursive: true });
    try { this.state = JSON.parse(await fs.readFile(this.file, 'utf8')); }
    catch (err) {
      if (err.code !== 'ENOENT') {
        try {
          this.state = JSON.parse(await fs.readFile(this.file + '.bak', 'utf8'));
          this.warnings.push('独立库索引损坏，已读取上一份备份。请保留索引文件以便排查。');
          await fs.copyFile(this.file, this.file + '.damaged-' + Date.now());
          await fs.copyFile(this.file + '.bak', this.file);
        } catch { throw new Error('独立库索引无法读取，请保留 library.json 与备份，勿覆盖原文件。'); }
      } else {
        this.state = { version: 1, sources: [], folders: [], items: [], overlays: {}, preferences: {} };
        if (defaultSource) {
          try { await fs.access(path.join(defaultSource, 'metadata.json')); this.state.sources.push({ id: crypto.randomUUID(), path: await fs.realpath(defaultSource), name: path.basename(defaultSource, '.library') }); }
          catch { /* 首次启动可稍后选择原库 */ }
        }
        await this.persist();
      }
    }
    if (this.state.version !== 1 || !Array.isArray(this.state.items) || !Array.isArray(this.state.sources)) throw new Error('不支持的独立库格式');
    await this.refresh();
    return this;
  }
  async persist() {
    const temp = this.file + '.tmp';
    await fs.writeFile(temp, JSON.stringify(this.state, null, 2));
    try { await fs.copyFile(this.file, this.file + '.bak'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    await fs.rename(temp, this.file);
  }
  transact(fn) {
    const operation = this.queue.then(async () => {
      const previous = structuredClone(this.state);
      try { const result = await fn(); await this.persist(); return result; }
      catch (e) { this.state = previous; throw e; }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  refresh() {
    const operation = this.queue.then(() => this.scanSources());
    this.queue = operation.catch(() => {});
    return operation;
  }
  async scanSources() {
    const items = [], folders = [], warnings = this.warnings.filter(x => x.startsWith('独立库'));
    for (const source of this.state.sources) {
      try {
        const root = await fs.realpath(source.path);
        const meta = JSON.parse(await fs.readFile(await safeFile(root, path.join(root, 'metadata.json')), 'utf8'));
        const prefix = `eagle:${source.id}:`;
        const visit = (nodes, parentId = null) => {
          for (const f of nodes || []) {
            if (typeof f.id !== 'string' || typeof f.name !== 'string') continue;
            // 密码文件夹内容不纳入首版，保留 Eagle 中的访问边界。
            if (f.password) continue;
            folders.push({ id: prefix + f.id, name: f.name, parentId, source: 'eagle' });
            visit(f.children, prefix + f.id);
          }
        };
        visit(meta.folders);
        const visibleFolders = new Set(folders.filter(f => f.id.startsWith(prefix)).map(f => f.id));
        const entries = await fs.readdir(path.join(root, 'images'), { withFileTypes: true });
        let invalid = 0;
        for (const dir of entries) {
          if (!dir.isDirectory() || !dir.name.endsWith('.info')) continue;
          try {
            const itemRoot = await safeFile(root, path.join(root, 'images', dir.name));
            const m = JSON.parse(await fs.readFile(await safeFile(itemRoot, path.join(itemRoot, 'metadata.json')), 'utf8'));
            if (m.isDeleted || typeof m.name !== 'string' || typeof m.id !== 'string') continue;
            const assigned = (m.folders || []).map(f => prefix + f);
            if (assigned.length && !assigned.some(f => visibleFolders.has(f))) continue;
            const ext = String(m.ext || '').toLowerCase();
            if (!/^[a-z0-9.]{0,20}$/.test(ext)) { invalid++; continue; }
            const files = await fs.readdir(itemRoot, { withFileTypes: true });
            // 名称修改存在覆盖层后，始终使用磁盘原文件名，而非覆盖层名称拼路径。
            const expected = `${m.name}${ext ? '.' + ext : ''}`;
            let original = files.find(f => f.isFile() && f.name === expected);
            if (!original) original = files.find(f => f.isFile() && f.name !== 'metadata.json' && !f.name.includes('_thumbnail.') && extractFileExtension(f.name) === ext);
            if (!original) { invalid++; continue; }
            const filePath = await safeFile(itemRoot, path.join(itemRoot, original.name));
            const thumb = files.find(f => f.isFile() && /_thumbnail\.(png|jpg|jpeg|webp)$/i.test(f.name));
            const thumbPath = thumb ? await safeFile(itemRoot, path.join(itemRoot, thumb.name)) : null;
            items.push({ id: prefix + m.id, name: m.name, ext, kind: kindOf(ext), size: Number(m.size) || 0,
              createdAt: Number(m.btime || m.mtime) || 0, modifiedAt: Number(m.modificationTime) || 0,
              tags: (m.tags || []).filter(t => typeof t === 'string'), folders: assigned.filter(f => visibleFolders.has(f)),
              annotation: String(m.annotation || ''), url: String(m.url || ''), width: Number(m.width) || 0,
              height: Number(m.height) || 0, duration: Number(m.duration) || 0, source: 'eagle', sourceName: source.name,
              filePath, thumbPath, itemRoot });
          } catch { invalid++; }
        }
        if (invalid) warnings.push(`${source.name}：${invalid} 条记录无法读取或缺少原文件，已略过。`);
      } catch (e) { warnings.push(`${source.name} 读取失败：${e.message}`); }
    }
    this.sourceItems = items; this.sourceFolders = folders; this.warnings = warnings;
    return this.summary();
  }
  items() {
    return [...this.sourceItems, ...this.state.items].map(item => ({ ...item, ...this.state.overlays[item.id] }));
  }
  folders() { return [...this.sourceFolders, ...this.state.folders]; }
  get(id) {
    const item = this.items().find(i => i.id === id);
    if (!item) throw new Error('素材不存在，请刷新素材库');
    return item;
  }
  publicItem(item) {
    const { filePath, thumbPath, itemRoot, ...rest } = item;
    return { ...rest, mediaURL: `asset://media/${encodeURIComponent(item.id)}/original`,
      thumbURL: thumbPath ? `asset://media/${encodeURIComponent(item.id)}/thumb` : (item.kind === 'image' ? `asset://media/${encodeURIComponent(item.id)}/original` : null) };
  }
  summary() {
    const items = this.items(), active = items.filter(i => !i.deleted), folders = this.folders();
    const descendants = id => { const result = new Set([id]); let changed = true; while (changed) { changed = false; for (const f of folders) if (result.has(f.parentId) && !result.has(f.id)) { result.add(f.id); changed = true; } } return result; };
    return { total: active.length, localCount: active.filter(i => i.source === 'local').length,
      sourceCount: active.filter(i => i.source === 'eagle').length, unfiled: active.filter(i => !i.folders.length).length,
      untagged: active.filter(i => !i.tags.length).length, trash: items.filter(i => i.deleted).length,
      folders: folders.map(f => { const ids = descendants(f.id); return { ...f, count: active.filter(i => i.folders.some(x => ids.has(x))).length }; }),
      tags: unique(active.flatMap(i => i.tags)).sort((a,b) => a.localeCompare(b, 'zh-CN')).map(name => ({ name, count: active.filter(i => i.tags.includes(name)).length })),
      sources: this.state.sources.map(({ id, name }) => ({ id, name })), preferences: this.state.preferences, warnings: this.warnings };
  }
  async query({ view = 'all', folderId, tag, text = '', kind = 'all', sort = 'newest', offset = 0, limit = 100 } = {}) {
    let items = this.items().filter(i => view === 'trash' ? i.deleted : !i.deleted);
    if (view === 'local') items = items.filter(i => i.source === 'local');
    if (view === 'unfiled') items = items.filter(i => !i.folders.length);
    if (view === 'untagged') items = items.filter(i => !i.tags.length);
    if (folderId) {
      const ids = new Set([folderId]), folders = this.folders();
      let changed = true;
      while (changed) { changed = false; for (const f of folders) if (ids.has(f.parentId) && !ids.has(f.id)) { ids.add(f.id); changed = true; } }
      items = items.filter(i => i.folders.some(f => ids.has(f)));
    }
    if (kind !== 'all') items = items.filter(i => i.kind === kind);
    if (tag) {
      // 复用 TagSpaces MIT 的标签筛选，按其大小写归一化约定传入索引。
      items = filterByTags(items.map(i => ({ ...i, _tags: i.tags, tags: i.tags.map(title => ({ title: title.toLowerCase() })) })), { tagsAND: [{ title: tag }] })
        .map(({ _tags, ...i }) => ({ ...i, tags: _tags }));
    }
    if (text.trim()) {
      const fuse = new Fuse(items, { keys: [{ name: 'name', weight: 0.6 }, 'tags', 'annotation'], ignoreLocation: true, threshold: 0.25, minMatchCharLength: 1 });
      items = fuse.search(text.trim()).map(r => r.item);
    }
    const compare = { newest: (a,b) => b.createdAt - a.createdAt, oldest: (a,b) => a.createdAt - b.createdAt,
      name: (a,b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }), size: (a,b) => b.size - a.size }[sort];
    if (compare) items.sort(compare);
    const total = items.length;
    return { total, items: items.slice(Math.max(0,offset), Math.max(0,offset) + Math.min(200, Math.max(1,limit))).map(i => this.publicItem(i)) };
  }
  async assetPath(id, part) {
    const item = this.get(id), file = part === 'thumb' ? item.thumbPath : part === 'original' ? item.filePath : null;
    if (!file) throw new Error('预览文件不存在');
    return safeFile(item.itemRoot, file);
  }
  edit(ids, patch) {
    return this.transact(async () => {
      if (!Array.isArray(ids) || !ids.length || ids.length > 2000) throw new Error('请选择素材');
      const valid = {};
      if ('name' in patch) { valid.name = cleanText(patch.name, 500); if (!valid.name) throw new Error('名称不能为空'); }
      if ('annotation' in patch) valid.annotation = cleanText(patch.annotation, 50000);
      if ('tags' in patch) { if (!Array.isArray(patch.tags) || patch.tags.length > 200) throw new Error('标签格式不正确'); valid.tags = unique(patch.tags.map(x => cleanText(x,100)).filter(Boolean)); }
      if ('folders' in patch) {
        const allowed = new Set(this.folders().map(f => f.id));
        if (!Array.isArray(patch.folders) || patch.folders.some(id => !allowed.has(id))) throw new Error('分类不存在');
        valid.folders = unique(patch.folders);
      }
      if ('deleted' in patch) { if (typeof patch.deleted !== 'boolean') throw new Error('回收状态不正确'); valid.deleted = patch.deleted; }
      for (const id of ids) { this.get(id); this.state.overlays[id] = { ...this.state.overlays[id], ...valid, modifiedAt: Date.now() }; }
      return ids.map(id => this.publicItem(this.get(id)));
    });
  }
  createFolder(name, parentId = null) {
    return this.transact(async () => {
      name = cleanText(name, 200);
      if (!name) throw new Error('文件夹名称不能为空');
      if (parentId && !this.folders().some(f => f.id === parentId)) throw new Error('上级文件夹不存在');
      const folder = { id: 'local:' + crypto.randomUUID(), name, parentId, source: 'local' };
      this.state.folders.push(folder); return folder;
    });
  }
  connectSource(sourcePath) {
    return this.transact(async () => {
      const root = await fs.realpath(sourcePath);
      if (inside(root, this.root) || inside(this.root, root)) throw new Error('原 Eagle 库与独立库必须分开存放');
      const metadata = JSON.parse(await fs.readFile(path.join(root, 'metadata.json'), 'utf8'));
      if (!Array.isArray(metadata.folders)) throw new Error('请选择有效的 Eagle .library 文件夹');
      const images = await fs.stat(path.join(root, 'images')); if (!images.isDirectory()) throw new Error('缺少 Eagle images 文件夹');
      if (!this.state.sources.some(s => s.path === root)) this.state.sources.push({ id: crypto.randomUUID(), path: root, name: path.basename(root,'.library') });
    }).then(() => this.refresh());
  }
  importPaths(inputPaths, folderId, onProgress = () => {}) {
    return this.transact(async () => {
      if (!Array.isArray(inputPaths) || !inputPaths.length) throw new Error('请选择导入文件');
      if (folderId && !this.folders().some(f => f.id === folderId)) throw new Error('导入分类不存在');
      const files = [], skipped = [], imported = [], duplicates = [], createdDirs = [];
      const walk = async (file, parent) => {
        const stat = await fs.lstat(file);
        if (stat.isSymbolicLink()) { skipped.push({ name: path.basename(file), reason: '跳过符号链接' }); return; }
        const real = await fs.realpath(file);
        if (inside(this.root, real)) { skipped.push({ name: path.basename(file), reason: '跳过独立库自身' }); return; }
        if (stat.isDirectory()) {
          if (path.basename(file).startsWith('.') || file.endsWith('.library')) { skipped.push({ name: path.basename(file), reason: 'Eagle 库请使用只读接入' }); return; }
          const folder = { id: 'local:' + crypto.randomUUID(), name: path.basename(file), parentId: parent || null, source: 'local' };
          this.state.folders.push(folder);
          for (const entry of await fs.readdir(file)) if (!entry.startsWith('.')) await walk(path.join(file,entry), folder.id);
        } else if (stat.isFile()) files.push({ file: real, parent, stat });
      };
      for (const file of inputPaths) await walk(file, folderId);
      const hashes = new Map(this.state.items.map(i => [i.hash, i]));
      try {
        for (let index = 0; index < files.length; index++) {
          const { file, parent, stat } = files[index];
          onProgress({ completed: index, total: files.length, name: path.basename(file) });
          const hash = await hashFile(file);
          if (hashes.has(hash)) {
            const existing = hashes.get(hash), current = this.get(existing.id);
            if (parent && !current.folders.includes(parent)) this.state.overlays[existing.id] = { ...this.state.overlays[existing.id], folders: [...current.folders, parent] };
            duplicates.push({ id: existing.id, name: path.basename(file) }); continue;
          }
          const id = 'local:' + crypto.randomUUID(), itemRoot = path.join(this.root, 'assets', id.slice(6));
          await fs.mkdir(itemRoot); createdDirs.push(itemRoot);
          const ext = extractFileExtension(file), filePath = path.join(itemRoot, 'original' + (ext ? '.' + ext : ''));
          await fs.copyFile(file, filePath, 1);
          if (await hashFile(filePath) !== hash) throw new Error(`复制校验失败：${path.basename(file)}`);
          const item = { id, name: path.basename(file, path.extname(file)), ext, kind: kindOf(ext), size: stat.size,
            createdAt: Date.now(), modifiedAt: Date.now(), tags: [], folders: parent ? [parent] : [], annotation: '',
            source: 'local', sourceName: '独立素材库', filePath, itemRoot, hash, width: 0, height: 0, duration: 0 };
          try { Object.assign(item, await this.thumbnailer(item) || {}); }
          catch { skipped.push({ name: path.basename(file), reason: '文件已导入，缩略图未生成' }); }
          this.state.items.push(item); hashes.set(hash, item); imported.push(this.publicItem(item));
        }
      } catch(e) { for (const dir of createdDirs) await fs.rm(dir, { recursive: true, force: true }); throw e; }
      onProgress({ completed: files.length, total: files.length, name: '' });
      return { imported, duplicates, skipped };
    });
  }
  savePreferences(values) {
    return this.transact(async () => {
      if (Number.isFinite(values.thumbSize)) this.state.preferences.thumbSize = Math.max(110, Math.min(280, values.thumbSize));
      if (['newest','oldest','name','size'].includes(values.sort)) this.state.preferences.sort = values.sort;
    });
  }
}
module.exports = { Library, kindOf, hashFile, safeFile, inside };
