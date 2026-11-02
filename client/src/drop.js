// Read browser drag data without inserting the supplied HTML into the page.
(() => {
  const http = value => { try { const u = new URL(value); return ['http:','https:'].includes(u.protocol) ? u.href : null; } catch { return null; } };
  window.readMediaDrop = transfer => {
    const html = transfer.getData('text/html'), uri = transfer.getData('text/uri-list'), plain = transfer.getData('text/plain');
    const links = (uri || plain).split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#')).map(http).filter(Boolean);
    const document = new DOMParser().parseFromString(html.slice(0, 2000000), 'text/html');
    const base = http(document.querySelector('base[href]')?.getAttribute('href')) || links[0];
    const resolve = value => { try { return http(new URL(value, base).href); } catch { return null; } };
    const media = [...document.querySelectorAll('img[src],audio[src],video[src],source[src]')].map(node => {
      const url = resolve(node.getAttribute('src'));
      const page = resolve(node.closest('a[href]')?.getAttribute('href'));
      return url ? { url, sourceURL: (page && page !== url ? page : links.find(u => u !== url)) || url,
        name: node.getAttribute('alt') || node.getAttribute('title') || '' } : null;
    }).filter(Boolean);
    if (!media.length) {
      const download = /^(.*?):(.*?):(https?:\/\/.*)$/s.exec(transfer.getData('DownloadURL'));
      if (download && http(download[3])) media.push({ url: http(download[3]), name: download[2] });
      else media.push(...links.map(url => ({ url })));
    }
    return [...new Map(media.map(item => [item.url, item])).values()].slice(0, 100);
  };
})();
