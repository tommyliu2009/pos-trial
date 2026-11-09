/* pos-lite-v5：有 Background Sync 時，關頁後仍可把快照送到後端。Safari 沒有這個 API，註冊會被略過。 */
const C='pos-lite-v5';const F=['./','index.html','lite.css','lite.js','core.js','config.js','manifest.json','icon.svg'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(F)))});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('pos-lite')&&k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
/* 先回快取（秒開），背景更新 */
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==location.origin)return;
e.respondWith(caches.open(C).then(c=>c.match(e.request).then(hit=>{const net=fetch(e.request,{cache:'no-store'}).then(r=>{if(r.ok)c.put(e.request,r.clone());return r}).catch(()=>hit);return hit||net})))});
function ldb(){return new Promise((res,rej)=>{const r=indexedDB.open('pos-lite-bg',1);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains('kv'))db.createObjectStore('kv')};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function lget(db){return new Promise((res,rej)=>{const q=db.transaction('kv').objectStore('kv').get('snap');q.onsuccess=()=>res(q.result||null);q.onerror=()=>rej(q.error)})}
function lpatch(db,fn){return new Promise((res,rej)=>{const tx=db.transaction('kv','readwrite'),st=tx.objectStore('kv'),g=st.get('snap');g.onsuccess=()=>{const cur=g.result;if(!cur)return;const next=fn(cur);if(next)st.put(next,'snap')};tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)})}
async function tell(acked,voided,sids){if(!acked.length&&!voided.length)return;const db=await ldb();
  await lpatch(db,cur=>{cur.ops=(cur.ops||[]).filter(x=>!acked.includes(x.payload.clientId));cur.voids=(cur.voids||[]).filter(v=>!voided.includes(v.clientId));return cur});
  const cs=await self.clients.matchAll({includeUncontrolled:true,type:'window'});cs.forEach(c=>c.postMessage({type:'lite-acked',ids:acked.slice(),voidIds:voided.slice(),sids}))}
async function bgFlush(){const db=await ldb();const first=await lget(db);if(!first||!first.api||!first.token)return;
  const acked=[],voided=[],sids={};const jobs=[];let budget=50000;
  for(const x of first.ops||[])jobs.push({kind:'op',x});
  for(const v of first.voids||[]){if(v.sid&&!(first.ops||[]).some(o=>o.payload.clientId===v.clientId))jobs.push({kind:'void',v})}
  try{for(const j of jobs){const cur=await lget(db);if(!cur||!cur.token||!cur.api)break;
    if(j.kind==='op'&&!(cur.ops||[]).some(o=>o.payload.clientId===j.x.payload.clientId))continue;
    if(j.kind==='void'&&!(cur.voids||[]).some(v=>v.clientId===j.v.clientId))continue;
    const action=j.kind==='op'?j.x.action:'void';
    const payload=j.kind==='op'?j.x.payload:{kind:j.v.kind,id:j.v.sid,reason:j.v.reason};
    const body=JSON.stringify({action,payload,token:cur.token});if(body.length>budget)continue;budget-=body.length;
    let r;try{const res=await fetch(cur.api,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body});r=await res.json()}catch(e){throw e}
    if(r&&r.relogin)break;
    if(!r||!r.ok){if(r&&/Lock|timeout|offline/i.test(r.error||''))throw new Error(r.error||'retry');continue}
    if(j.kind==='op'){acked.push(j.x.payload.clientId);const sv=r.sale||r.expense;if(sv&&sv.id)sids[j.x.payload.clientId]=sv.id}else voided.push(j.v.clientId)}}
  finally{await tell(acked,voided,sids)}}
self.addEventListener('sync',e=>{if(e.tag==='lite-flush')e.waitUntil(bgFlush())});
