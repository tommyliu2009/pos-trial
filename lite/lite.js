/* POS Lite：本機優先，結帳立即完成，背景批次上傳 */
const MOCK=!window.POS_API_URL;
const $=s=>document.querySelector(s),app=$('#app');
const LS={g:(k,d)=>{try{return JSON.parse(localStorage.getItem('lite_'+k))??d}catch(e){return d}},s:(k,v)=>localStorage.setItem('lite_'+k,JSON.stringify(v))};
const money=n=>'$'+Math.round(n).toLocaleString();const today=()=>new Date().toLocaleDateString('sv');
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const PAYS=['現金','LINE Pay','街口支付','悠遊卡','其他'];const CATS=['進貨','材料','雜支','水電','交通','其他'];
const STORES=[['store2','林內驛站'],['store3','古坑咖啡合作社'],['store1','苗栗桂妃油茶']];
let S=LS.g('sess',{}),cart=[],pay='現金',tab='sale';
/* ===== 後端 ===== */
function mockDb(){let d=localStorage.getItem('mockdb');if(d)return JSON.parse(d);const db={};Object.keys(TABLES).forEach(k=>db[k]=[]);seed(db,window.MOCK_PW||{});
  const m={linnei:'store2',gukeng:'store3',guifei:'store1'};db.accounts.forEach(a=>{if(m[a.username])a.username=m[a.username]});localStorage.setItem('mockdb',JSON.stringify(db));return db}
const mockSess={get:t=>JSON.parse(localStorage.getItem('ms_'+t)||'null'),set:(t,v)=>localStorage.setItem('ms_'+t,JSON.stringify(v)),del:t=>localStorage.removeItem('ms_'+t)};
async function api(action,payload){const req={action,payload,token:S.token};let r;
  if(MOCK){if(localStorage.getItem('mockOffline'))throw new Error('offline');await new Promise(z=>setTimeout(z,+(localStorage.getItem('mockDelay')||0)));const db=mockDb();
    const one=q=>{try{return handle(db,mockSess,q)}catch(e){return{ok:false,error:e.message}}};
    r=action==='batch'?{ok:true,results:payload.ops.map(o=>one({action:o.action,payload:o.payload,token:S.token}))}:one(req);
    if(r.results&&r.results[0]&&r.results[0].relogin)r={ok:false,relogin:true,error:r.results[0].error};localStorage.setItem('mockdb',JSON.stringify(db))}
  else{const res=await fetch(window.POS_API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(req)});r=await res.json()}
  if(r.relogin){S.expired=true;LS.s('sess',S);netUI();if(action!=='login')loginView();throw new Error(r.error)}if(!r.ok)throw new Error(r.error);return r}
/* ===== 上傳佇列（clientId 防重複；後端遇到相同 clientId 會回 dup） ===== */
let busy=false,fails=0,noBatch=LS.g('noBatch',false),timer=null;
const Q=()=>LS.g('queue',[]);
function enqueue(action,payload){const q=Q();q.push({action,payload,u:S.username});LS.s('queue',q);netUI();clearTimeout(timer);timer=setTimeout(flush,800)}
function drop(ids){LS.s('queue',Q().filter(x=>!ids.includes(x.payload.clientId)));}
async function flush(){if(busy||!S.token||S.expired)return;const q=Q().filter(x=>x.u===S.username);if(!q.length)return;busy=true;netUI();
  try{const part=q.slice(0,25);
    if(!noBatch){try{const r=await api('batch',{ops:part});const ok=[];r.results.forEach((x,i)=>{if(x.ok||!/逾時|offline|Lock|timeout/i.test(x.error||''))ok.push(part[i].payload.clientId);if(!x.ok)console.warn('上傳被拒',x.error)});drop(ok)}
      catch(e){if(/未知動作/.test(e.message)){noBatch=true;LS.s('noBatch',true)}else throw e}}
    if(noBatch){for(const x of part){try{await api(x.action,x.payload)}catch(e){if(/Failed|offline|Network|逾時/i.test(e.message))throw e;console.warn('上傳被拒',e.message)}drop([x.payload.clientId])}}
    fails=0}catch(e){fails++}finally{busy=false;netUI()}
  if(Q().some(x=>x.u===S.username)&&!S.expired)setTimeout(flush,fails?Math.min(60e3,2000*2**fails):100)}
function netUI(){const el=$('#net');if(!el)return;const n=Q().length,off=!navigator.onLine||localStorage.getItem('mockOffline');
  el.textContent=(S.expired?'請重新登入以上傳':off?'離線':busy?'上傳中':'已連線')+(n?`・待上傳 ${n}`:'')+(MOCK?'・測試模式':'');el.className=off||S.expired?'off':n?'wait':''}
addEventListener('online',()=>{fails=0;flush()});addEventListener('offline',netUI);setInterval(()=>{if(!busy)flush()},15000);
/* ===== 本機帳本（今日小計） ===== */
function ledger(){const L=LS.g('ledger_'+S.storeId,[]),d=today();const k=L.filter(x=>x.day===d);if(k.length!==L.length)LS.s('ledger_'+S.storeId,k);return k}
function addLedger(x){const L=ledger();L.push(x);LS.s('ledger_'+S.storeId,L)}
let tt;function toast(t){const el=$('#toast');el.textContent=t;el.classList.add('show');clearTimeout(tt);tt=setTimeout(()=>el.classList.remove('show'),1400)}
/* ===== 登入 ===== */
function loginView(){$('#logout').hidden=true;$('#who').textContent='';app.innerHTML=`<div class="card login"><h2 style="margin:0">店面登入</h2>
<select id="u">${STORES.map(([u,n])=>`<option value="${u}" ${S.username===u?'selected':''}>${n}</option>`).join('')}</select>
<input id="p" type="password" placeholder="密碼" autocomplete="current-password"><button id="go">登入</button><div id="err" style="color:#c0392b"></div></div>`;
  const go=async()=>{$('#go').disabled=true;$('#go').textContent='登入中…';try{const r=await api('login',{username:$('#u').value,password:$('#p').value});
    if(r.role!=='store')throw new Error('Lite 版只供門市帳號使用');S={token:r.token,username:r.username,storeId:r.storeId,storeName:r.storeName.replace(/（.*?）/,'')};LS.s('sess',S);start();flush()}
    catch(e){$('#err').textContent=e.message;$('#go').disabled=false;$('#go').textContent='登入'}};
  $('#go').onclick=go;$('#p').onkeydown=e=>{if(e.key==='Enter')go()};$('#p').focus()}
$('#logout').onclick=()=>{if(Q().length&&!confirm(`還有 ${Q().length} 筆未上傳，登出後會保留在這台裝置，下次登入再上傳。確定登出？`))return;api('logout').catch(()=>{});S={username:S.username};LS.s('sess',S);loginView()};
/* ===== 主畫面 ===== */
function items(){return LS.g('items_'+S.storeId,[]).filter(i=>i.active===true||i.active==='TRUE'||i.active==='true')}
function refreshItems(){api('items',{}).then(r=>{const old=JSON.stringify(LS.g('items_'+S.storeId,[]));LS.s('items_'+S.storeId,r.items);if(old!==JSON.stringify(r.items)&&tab==='sale')draw()}).catch(()=>{})}
function start(){$('#logout').hidden=false;$('#who').textContent=S.storeName||'';draw();refreshItems();netUI()}
function draw(){app.innerHTML=`<div class="tabs">${[['sale','結帳'],['exp','記支出'],['day','今日小計']].map(([k,n])=>`<button data-t="${k}" class="${tab===k?'on':''}">${n}</button>`).join('')}</div><div id="body"></div>`;
  app.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{tab=b.dataset.t;draw()});({sale:saleView,exp:expView,day:dayView})[tab]()}
function saleView(){const its=items();$('#body').innerHTML=`<div class="pos"><div class="grid" id="grid">${its.length?its.map(i=>`<button class="it" data-id="${esc(i.id)}">${esc(i.name)}<small>${money(i.price)}</small></button>`).join(''):'<div class="card">商品載入中…（第一次需要連線）</div>'}</div>
<div class="card cart"><div id="lines"></div><div class="tot" id="tot">$0</div>
<div class="pays">${PAYS.map(p=>`<button data-p="${p}">${p}</button>`).join('')}</div>
<div id="cash"><div class="row"><span>收現金</span><input id="paid" type="number" inputmode="numeric" placeholder="免填＝剛好"></div><div class="quick">${[100,500,1000].map(v=>`<button data-q="${v}">${v}</button>`).join('')}<button data-q="0">剛好</button></div><div class="row" style="margin-top:6px"><span>找零</span><b id="chg" style="font-size:26px">$0</b></div></div>
<button class="go" id="pay">結帳</button><button class="sec" id="clr">清空</button></div></div>`;
  const byId={};its.forEach(i=>byId[i.id]=i);
  $('#grid').onclick=e=>{const b=e.target.closest('.it');if(!b)return;const it=byId[b.dataset.id],l=cart.find(x=>x.id===it.id);if(l)l.qty++;else cart.push({id:it.id,name:it.name,price:+it.price,qty:1});drawCart()};
  $('#body').querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>{pay=b.dataset.p;drawCart()});
  $('#body').querySelectorAll('[data-q]').forEach(b=>b.onclick=()=>{$('#paid').value=+b.dataset.q?(+$('#paid').value||0)+ +b.dataset.q:'';drawCart()});
  $('#paid').oninput=drawCart;$('#clr').onclick=()=>{cart=[];$('#paid').value='';drawCart()};$('#pay').onclick=checkout;
  $('#lines').onclick=e=>{const b=e.target.closest('[data-d]');if(!b)return;const l=cart[+b.dataset.i];l.qty+= +b.dataset.d;if(l.qty<=0)cart.splice(+b.dataset.i,1);drawCart()};drawCart()}
const total=()=>cart.reduce((s,l)=>s+l.price*l.qty,0);
function drawCart(){const t=total();$('#lines').innerHTML=cart.length?cart.map((l,i)=>`<div class="ln"><span>${esc(l.name)}<br><small>${money(l.price)} × ${l.qty}</small></span><button class="sec" data-i="${i}" data-d="-1">−</button><b>${l.qty}</b><button data-i="${i}" data-d="1">＋</button></div>`).join(''):'<div style="color:#888">點左邊商品加入</div>';
  $('#tot').textContent=money(t);$('#body').querySelectorAll('[data-p]').forEach(b=>b.classList.toggle('on',b.dataset.p===pay));$('#cash').style.display=pay==='現金'?'':'none';
  const p=+$('#paid').value||t;$('#chg').textContent=money(Math.max(0,p-t));$('#grid').querySelectorAll('.it').forEach(b=>{const l=cart.find(x=>x.id===b.dataset.id);let i=b.querySelector('i');if(l){if(!i){i=document.createElement('i');b.appendChild(i)}i.textContent=l.qty}else if(i)i.remove()})}
function checkout(){const t0=performance.now(),t=total();if(!cart.length)return toast('購物車是空的');
  const paid=pay==='現金'?(+$('#paid').value||t):t;if(paid<t)return toast('收現金不足');
  const p={clientId:uid('c')+'|'+pay,time:new Date().toISOString(),lines:cart.map(({id,name,price,qty})=>({id,name,price,qty})),paid};
  enqueue('sale',p);addLedger({k:'sale',day:today(),time:p.time,total:t,pay,clientId:p.clientId,n:cart.reduce((s,l)=>s+l.qty,0)});
  cart=[];$('#paid').value='';drawCart();const ms=performance.now()-t0;window.lastCheckoutMs=ms;toast(`✔ 結帳完成 ${money(t)}`+(paid>t?`　找零 ${money(paid-t)}`:''))}
function expView(){$('#body').innerHTML=`<div class="card" style="max-width:520px;display:flex;flex-direction:column;gap:10px">
<div class="pays" id="cats">${CATS.map((c,i)=>`<button data-c="${c}" class="${i==0?'on':''}">${c}</button>`).join('')}</div>
<input id="amt" type="number" inputmode="numeric" placeholder="金額"><input id="note" placeholder="備註（可不填）"><button class="go" id="save">記一筆支出</button></div>`;
  let cat=CATS[0];$('#cats').onclick=e=>{const b=e.target.closest('[data-c]');if(!b)return;cat=b.dataset.c;$('#cats').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b))};
  const save=()=>{const a=+$('#amt').value;if(!(a>0))return toast('請輸入金額');const p={clientId:uid('c'),time:new Date().toISOString(),category:cat,note:$('#note').value.trim(),amount:a};
    enqueue('expense',p);addLedger({k:'exp',day:today(),time:p.time,total:a,cat,note:p.note,clientId:p.clientId});$('#amt').value='';$('#note').value='';toast(`✔ 已記支出 ${money(a)}`);$('#amt').focus()};
  $('#save').onclick=save;$('#amt').onkeydown=e=>{if(e.key==='Enter')save()};$('#amt').focus()}
function dayView(){const L=ledger(),q=new Set(Q().map(x=>x.payload.clientId)),s=L.filter(x=>x.k==='sale'),e=L.filter(x=>x.k==='exp');const sum=a=>a.reduce((t,x)=>t+x.total,0);
  const byPay={};s.forEach(x=>byPay[x.pay]=(byPay[x.pay]||0)+x.total);
  $('#body').innerHTML=`<div class="kpi"><div>今日營收<b>${money(sum(s))}</b></div><div>交易筆數<b>${s.length}</b></div><div>今日支出<b>${money(sum(e))}</b></div><div>今日淨額<b>${money(sum(s)-sum(e))}</b></div></div>
<p>${Object.entries(byPay).map(([k,v])=>`${esc(k)} ${money(v)}`).join('　')||'今天還沒有交易'}</p>
<table><tr><th>時間</th><th>項目</th><th>金額</th><th>狀態</th></tr>${L.slice().reverse().map(x=>`<tr><td>${new Date(x.time).toLocaleTimeString('zh-TW',{hour12:false,hour:'2-digit',minute:'2-digit'})}</td><td>${x.k==='sale'?'銷售・'+esc(x.pay)+'・'+x.n+'件':'支出・'+esc(x.cat)+(x.note?'・'+esc(x.note):'')}</td><td>${money(x.total)}</td><td>${q.has(x.clientId)?'待上傳':'已上傳'}</td></tr>`).join('')}</table>
<p style="color:#888;font-size:14px">今日小計只算這台裝置的紀錄。作廢、改品項請用完整版。</p>`}
if('serviceWorker' in navigator&&!/^(localhost|127\.0\.0\.1)$/.test(location.hostname))navigator.serviceWorker.register('sw.js');
if(S.token&&!S.expired)start();else loginView();netUI();flush();
