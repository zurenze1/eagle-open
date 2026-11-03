// Read browser drag data without inserting the supplied HTML into the page.
(() => {
  const http = value => { if(typeof value!=='string'||!value.trim())return null;try { const u = new URL(value); return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password ? u.href : null; } catch { return null; } };
  window.readMediaDrop = transfer => {
    const html = transfer.getData('text/html'), uri = transfer.getData('text/uri-list'), plain = transfer.getData('text/plain'), moz=transfer.getData('text/x-moz-url').split(/\r?\n/);
    const candidates=(uri || moz[0] || plain).split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
    const links = candidates.map(http).filter(Boolean),inline=candidates.find(s=>/^data:image\//i.test(s));
    const document = new DOMParser().parseFromString(html.slice(0, 2000000), 'text/html');
    const base = http(document.querySelector('base[href]')?.getAttribute('href')) || links[0];
    const resolve = value => { if(typeof value!=='string'||!value.trim())return null;try { const u=new URL(value,base);return http(u.href)||(/^data:image\//i.test(u.href)?u.href:null); } catch { return null; } };
    const nodes=[...document.querySelectorAll('img[src],audio[src],video[src],source[src]')];
    const media = nodes.filter(node=>node.tagName!=='IMG'||!node.closest('a')||!nodes.some(other=>['VIDEO','AUDIO','SOURCE'].includes(other.tagName)&&other.closest('a')===node.closest('a'))).map(node => {
      const url = resolve(node.getAttribute('src'));
      const page = resolve(node.closest('a[href]')?.getAttribute('href'));
      return url ? { url, sourceURL: (page && page !== url ? page : links.find(u => u !== url)) || http(url) || '',
        name: node.getAttribute('alt') || node.getAttribute('title') || '',...((node.tagName==='VIDEO'||node.closest('video'))?{expectedKind:'video'}:{}) } : null;
    }).filter(Boolean);
    if (!media.length) {
      const download = /^(.*?):(.*?):(https?:\/\/.*)$/s.exec(transfer.getData('DownloadURL'));
      if (download && http(download[3])) media.push({ url: http(download[3]), name: download[2] });
      else if(inline)media.push({url:inline,sourceURL:links[0]||''});
      else media.push(...links.map(url => ({ url, pageOnly:true, ...(moz[1]?{name:moz[1]}:{}) })));
    }
    for(const item of media){try{const page=new URL(item.sourceURL||item.url);item.resolvePage=/(^|\.)pinterest\./.test(page.hostname)&&/^\/pin\//.test(page.pathname);}catch{}}
    return [...new Map(media.map(item => [item.url, item])).values()].slice(0, 100);
  };
})();
