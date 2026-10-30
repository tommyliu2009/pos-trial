const C='pos-lite-v2';const F=['./','index.html','lite.css','lite.js','core.js','config.js','manifest.json','icon.svg'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(F)))});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('pos-lite')&&k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
/* 先回快取（秒開），背景更新 */
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==location.origin)return;
e.respondWith(caches.open(C).then(c=>c.match(e.request).then(hit=>{const net=fetch(e.request,{cache:'no-store'}).then(r=>{if(r.ok)c.put(e.request,r.clone());return r}).catch(()=>hit);return hit||net})))});
