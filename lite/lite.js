/* POS Lite：本機優先，結帳立即完成，背景批次上傳 */
const MOCK=!window.POS_API_URL;
const $=s=>document.querySelector(s),app=$('#app');
const LS={g:(k,d)=>{try{return JSON.parse(localStorage.getItem('lite_'+k))??d}catch(e){return d}},s:(k,v)=>localStorage.setItem('lite_'+k,JSON.stringify(v))};
const money=n=>'$'+Math.round(n).toLocaleString();const today=()=>new Date().toLocaleDateString('sv');
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const PAYS=['現金','LINE Pay','街口支付','悠遊卡','其他'];const CATS=['進貨','材料','雜支','水電','交通','其他'];
const STORES=[['store2','林內驛站'],['store3','古坑咖啡合作社'],['store1','苗栗桂妃油茶']];
/* L2：開頁即背景叫醒後端（GET doGet，極輕量） */
let lastWarm=0;function warm(){if(MOCK||Date.now()-lastWarm<240e3)return;lastWarm=Date.now();fetch(window.POS_API_URL,{mode:'no-cors',cache:'no-store'}).catch(()=>{})}
warm();document.addEventListener('visibilitychange',()=>{if(!document.hidden)warm()});
let S=LS.g('sess',{}),cart=[],pay='現金',tab='sale',disc=null,discOpen=false;
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
async function flush(){if(busy||!S.token||S.expired)return;const q=Q().filter(x=>x.u===S.username);if(!q.length){if(VQ().some(x=>x.u===S.username)){busy=true;try{await flushVoids()}catch(e){}finally{busy=false;netUI()}}return}busy=true;netUI();
  try{const part=q.slice(0,25);
    if(!noBatch){try{const r=await api('batch',{ops:part});const ok=[];r.results.forEach((x,i)=>{const sv=x.sale||x.expense;if(sv&&sv.id)setSid(part[i].payload.clientId,sv.id);if(x.ok||!/逾時|offline|Lock|timeout/i.test(x.error||''))ok.push(part[i].payload.clientId);if(!x.ok)console.warn('上傳被拒',x.error)});drop(ok)}
      catch(e){if(/未知動作/.test(e.message)){noBatch=true;LS.s('noBatch',true)}else throw e}}
    if(noBatch){for(const x of part){try{const r=await api(x.action,x.payload);const sv=r.sale||r.expense;if(sv&&sv.id)setSid(x.payload.clientId,sv.id)}catch(e){if(/Failed|offline|Network|逾時/i.test(e.message))throw e;console.warn('上傳被拒',e.message)}drop([x.payload.clientId])}}
    await flushVoids();fails=0}catch(e){fails++}finally{busy=false;netUI()}
  if(Q().some(x=>x.u===S.username)&&!S.expired)setTimeout(flush,fails?Math.min(60e3,2000*2**fails):100)}
/* ===== L3 快速作廢：未上傳＝本機刪除；已上傳＝背景佇列呼叫既有「作廢」 ===== */
const VQ=()=>LS.g('vqueue',[]);
function setSid(cid,id){const L=LS.g('ledger_'+S.storeId,[]);const x=L.find(y=>y.clientId===cid);if(x){x.sid=id;LS.s('ledger_'+S.storeId,L)}}
async function flushVoids(){for(const v of VQ().filter(x=>x.u===S.username)){
  if(Q().some(x=>x.payload.clientId===v.clientId))continue;let id=v.sid;
  if(!id){const r=await api('records',{prefix:v.time.slice(0,10)});const hit=(v.kind==='sale'?r.sales:r.expenses).find(x=>x.clientId===v.clientId);
    if(!hit){const all=VQ(),m=all.find(x=>x.clientId===v.clientId);m.miss=(m.miss||0)+1;LS.s('vqueue',m.miss>5?all.filter(x=>x!==m):all);if(m.miss>5)console.warn('作廢找不到原始交易，請到 Pro 版處理',v.clientId);continue}id=hit.id}
  try{await api('void',{kind:v.kind,id,reason:v.reason})}catch(e){if(/Failed|offline|Network|逾時/i.test(e.message))throw e;console.warn('作廢被拒',e.message)}
  LS.s('vqueue',VQ().filter(x=>x.clientId!==v.clientId))}if(tab==='day'&&$('#body'))dayView()}
function quickVoid(cid){const L=LS.g('ledger_'+S.storeId,[]),x=L.find(y=>y.clientId===cid);if(!x||x.void)return;
  const reason=prompt(`作廢這筆 ${money(x.total)}？請輸入原因（例：按錯、退貨）`);if(!reason||!reason.trim())return;
  const inQ=Q().some(y=>y.payload.clientId===cid);
  if(inQ){LS.s('queue',Q().filter(y=>y.payload.clientId!==cid));x.void='local'}
  else{const v=VQ();v.push({u:S.username,kind:x.k==='sale'?'sale':'exp',clientId:cid,sid:x.sid||'',time:x.time,reason:reason.trim()});LS.s('vqueue',v);x.void='queued'}
  x.reason=reason.trim();LS.s('ledger_'+S.storeId,L);toast(inQ?'✔ 已作廢（尚未上傳，直接刪除）':'✔ 已作廢，背景同步中');dayView();clearTimeout(timer);timer=setTimeout(flush,300)}
function netUI(){const el=$('#net');if(!el)return;const n=Q().length+VQ().length,off=!navigator.onLine||localStorage.getItem('mockOffline');
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
  const go=async()=>{const tl0=performance.now();$('#go').disabled=true;$('#go').textContent='登入中…';try{const r=await api('login',{username:$('#u').value,password:$('#p').value});
    if(r.role!=='store')throw new Error('Lite 版只供門市帳號使用');S={token:r.token,username:r.username,storeId:r.storeId,storeName:r.storeName.replace(/（.*?）/,''),loginAt:Date.now()};LS.s('sess',S);
    if(r.items){LS.s('items_'+S.storeId,r.items);LS.s('itemsVer_'+S.storeId,r.itemsVer||'');S.itemsFresh=true}window.lastLoginMs=Math.round(performance.now()-tl0);console.log('login ms',window.lastLoginMs);
    if(!LS.g('pin_'+S.username,null))offerPin(()=>{start();flush()});else{start();flush()}}
    catch(e){$('#err').textContent=e.message;$('#go').disabled=false;$('#go').textContent='登入'}};
  $('#go').onclick=go;$('#p').onkeydown=e=>{if(e.key==='Enter')go()};$('#p').focus()}
$('#logout').onclick=()=>{if(Q().length&&!confirm(`還有 ${Q().length} 筆未上傳，登出後會保留在這台裝置，下次登入再上傳。確定登出？`))return;api('logout').catch(()=>{});S={username:S.username};LS.s('sess',S);loginView()};
$('#who').onclick=()=>{if(S.token&&LS.g('pin_'+S.username,null)&&confirm('鎖定畫面？（用 PIN 解鎖）'))lockView()};
/* ===== 主畫面 ===== */
function items(){return LS.g('items_'+S.storeId,[]).filter(i=>i.active===true||i.active==='TRUE'||i.active==='true')}
function refreshItems(){if(S.itemsFresh){S.itemsFresh=false;return}const ver=LS.g('itemsVer_'+S.storeId,'');api('items',ver&&LS.g('items_'+S.storeId,[]).length?{ver}:{}).then(r=>{if(r.notModified||!r.items)return;LS.s('itemsVer_'+S.storeId,r.itemsVer||'');const old=JSON.stringify(LS.g('items_'+S.storeId,[]));LS.s('items_'+S.storeId,r.items);if(old!==JSON.stringify(r.items)&&tab==='sale')draw()}).catch(()=>{})}
function start(){touch();$('#logout').hidden=false;$('#who').textContent=S.storeName||'';draw();refreshItems();netUI()}
function draw(){app.innerHTML=`<div class="tabs">${[['sale','結帳'],['exp','記支出'],['day','今日小計']].map(([k,n])=>`<button data-t="${k}" class="${tab===k?'on':''}">${n}</button>`).join('')}</div><div id="body"></div>`;
  app.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{tab=b.dataset.t;draw()});({sale:saleView,exp:expView,day:dayView})[tab]()}
function saleView(){const its=items();$('#body').innerHTML=`<div class="pos"><div class="grid" id="grid">${its.length?its.map(i=>`<button class="it" data-id="${esc(i.id)}">${esc(i.name)}<small>${money(i.price)}</small></button>`).join(''):'<div class="card">商品載入中…（第一次需要連線）</div>'}</div>
<div class="card cart"><div id="lines"></div><div class="sub" id="sub"></div><div class="tot" id="tot">$0</div>
<button class="sec dbtn" id="dbtn">折扣</button><div class="dpanel" id="dpanel" hidden>${[['a',10,'減$10'],['a',50,'減$50'],['a',0,'減自訂'],['p',95,'95折'],['p',90,'9折'],['p',80,'8折'],['p',0,'自訂折'],['x',0,'取消折扣']].map(([t,v,n])=>`<button data-dt="${t}" data-dv="${v}" class="${t==='x'?'sec':''}">${n}</button>`).join('')}</div>
<div class="pays">${PAYS.map(p=>`<button data-p="${p}">${p}</button>`).join('')}</div>
<div id="cash"><div class="row"><span>收現金</span><input id="paid" type="number" inputmode="numeric" placeholder="免填＝剛好"></div><div class="quick">${[100,500,1000].map(v=>`<button data-q="${v}">${v}</button>`).join('')}<button data-q="0">剛好</button></div><div class="row" style="margin-top:6px"><span>找零</span><b id="chg" style="font-size:26px">$0</b></div></div>
<button class="go" id="pay">結帳</button><button class="sec" id="clr">清空</button></div></div>`;
  const byId={};its.forEach(i=>byId[i.id]=i);
  $('#grid').onclick=e=>{const b=e.target.closest('.it');if(!b)return;const it=byId[b.dataset.id],l=cart.find(x=>x.id===it.id);if(l)l.qty++;else cart.push({id:it.id,name:it.name,price:+it.price,qty:1});drawCart()};
  $('#body').querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>{pay=b.dataset.p;drawCart()});
  $('#body').querySelectorAll('[data-q]').forEach(b=>b.onclick=()=>{$('#paid').value=+b.dataset.q?(+$('#paid').value||0)+ +b.dataset.q:'';drawCart()});
  $('#dbtn').onclick=()=>{discOpen=!discOpen;drawCart()};
  $('#dpanel').onclick=e=>{const b=e.target.closest('[data-dt]');if(!b)return;let t=b.dataset.dt,v=+b.dataset.dv;
    if(t==='x')disc=null;else{if(!v){const r=prompt(t==='a'?'減多少元？':'打幾折？（例：85＝85折，7＝7折）');if(r===null)return;v=+r;if(t==='p'&&v>0&&v<10)v*=10;if(!(v>0)||(t==='p'&&v>=100))return toast('數字不正確')}
      disc={t,v,n:t==='a'?'減$'+v:(v%10?v:v/10)+'折'}}discOpen=false;drawCart()};
  $('#paid').oninput=drawCart;$('#clr').onclick=()=>{cart=[];disc=null;$('#paid').value='';drawCart()};$('#pay').onclick=checkout;
  $('#lines').onclick=e=>{const b=e.target.closest('[data-d]');if(!b)return;const l=cart[+b.dataset.i];l.qty+= +b.dataset.d;if(l.qty<=0)cart.splice(+b.dataset.i,1);drawCart()};drawCart()}
const subtotal=()=>cart.reduce((s,l)=>s+l.price*l.qty,0);
const discAmt=()=>{const s=subtotal();if(!disc||!s)return 0;return Math.min(s,disc.t==='a'?disc.v:Math.round(s*(100-disc.v)/100))};
const total=()=>Math.max(0,subtotal()-discAmt());
function drawCart(){const t=total();$('#lines').innerHTML=cart.length?cart.map((l,i)=>`<div class="ln"><span>${esc(l.name)}<br><small>${money(l.price)} × ${l.qty}</small></span><button class="sec" data-i="${i}" data-d="-1">−</button><b>${l.qty}</b><button data-i="${i}" data-d="1">＋</button></div>`).join(''):'<div style="color:#888">點左邊商品加入</div>';
  const d=discAmt();$('#sub').innerHTML=d?`小計 ${money(subtotal())}　<span class="dv">折扣 ${esc(disc.n)} −${money(d)}</span>`:'';$('#tot').textContent=money(t);
  $('#dbtn').textContent=disc?'折扣：'+disc.n:'折扣';$('#dbtn').classList.toggle('on',!!disc);$('#dpanel').hidden=!discOpen;$('#body').querySelectorAll('[data-p]').forEach(b=>b.classList.toggle('on',b.dataset.p===pay));$('#cash').style.display=pay==='現金'?'':'none';
  const p=+$('#paid').value||t;$('#chg').textContent=money(Math.max(0,p-t));$('#grid').querySelectorAll('.it').forEach(b=>{const l=cart.find(x=>x.id===b.dataset.id);let i=b.querySelector('i');if(l){if(!i){i=document.createElement('i');b.appendChild(i)}i.textContent=l.qty}else if(i)i.remove()})}
function checkout(){const t0=performance.now(),t=total();if(!cart.length)return toast('購物車是空的');
  const paid=pay==='現金'?(+$('#paid').value||t):t;if(paid<t)return toast('收現金不足');const d=discAmt(),lines=cart.map(({id,name,price,qty})=>({id,name,price,qty}));
  if(d)lines.push({id:'DISC',name:'折扣',price:-d,qty:1});
  const p={clientId:uid('c')+'|'+pay+(d?'|D'+d:''),time:new Date().toISOString(),lines,paid:paid||0};
  enqueue('sale',p);addLedger({k:'sale',day:today(),time:p.time,total:t,disc:d,pay,clientId:p.clientId,n:cart.reduce((s,l)=>s+l.qty,0)});
  cart=[];disc=null;$('#paid').value='';drawCart();const ms=performance.now()-t0;window.lastCheckoutMs=ms;toast(`✔ 結帳完成 ${money(t)}`+(paid>t?`　找零 ${money(paid-t)}`:''))}
function expView(){$('#body').innerHTML=`<div class="card" style="max-width:520px;display:flex;flex-direction:column;gap:10px">
<div class="pays" id="cats">${CATS.map((c,i)=>`<button data-c="${c}" class="${i==0?'on':''}">${c}</button>`).join('')}</div>
<input id="amt" type="number" inputmode="numeric" placeholder="金額"><input id="note" placeholder="備註（可不填）"><button class="go" id="save">記一筆支出</button></div>`;
  let cat=CATS[0];$('#cats').onclick=e=>{const b=e.target.closest('[data-c]');if(!b)return;cat=b.dataset.c;$('#cats').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b))};
  const save=()=>{const a=+$('#amt').value;if(!(a>0))return toast('請輸入金額');const p={clientId:uid('c'),time:new Date().toISOString(),category:cat,note:$('#note').value.trim(),amount:a};
    enqueue('expense',p);addLedger({k:'exp',day:today(),time:p.time,total:a,cat,note:p.note,clientId:p.clientId});$('#amt').value='';$('#note').value='';toast(`✔ 已記支出 ${money(a)}`);$('#amt').focus()};
  $('#save').onclick=save;$('#amt').onkeydown=e=>{if(e.key==='Enter')save()};$('#amt').focus()}
function dayView(){const L=ledger(),q=new Set(Q().map(x=>x.payload.clientId)),s=L.filter(x=>x.k==='sale'),e=L.filter(x=>x.k==='exp');const sum=a=>a.filter(x=>!x.void).reduce((t,x)=>t+x.total,0);
  const byPay={};s.filter(x=>!x.void).forEach(x=>byPay[x.pay]=(byPay[x.pay]||0)+x.total);
  $('#body').innerHTML=`<div class="kpi"><div>今日營收<b>${money(sum(s))}</b></div><div>交易筆數<b>${s.filter(x=>!x.void).length}</b></div><div>今日支出<b>${money(sum(e))}</b></div><div>今日淨額<b>${money(sum(s)-sum(e))}</b></div></div>
<p>${Object.entries(byPay).map(([k,v])=>`${esc(k)} ${money(v)}`).join('　')||'今天還沒有交易'}</p>
<table><tr><th>時間</th><th>項目</th><th>金額</th><th>狀態</th><th></th></tr>${L.slice().reverse().map(x=>`<tr class="${x.void?'void':''}"><td>${new Date(x.time).toLocaleTimeString('zh-TW',{hour12:false,hour:'2-digit',minute:'2-digit'})}</td><td>${x.k==='sale'?'銷售・'+esc(x.pay)+'・'+x.n+'件'+(x.disc?'・折'+money(x.disc):''):'支出・'+esc(x.cat)+(x.note?'・'+esc(x.note):'')}</td><td>${money(x.total)}</td><td>${x.void==='local'?'已作廢（未上傳）':x.void?(VQ().some(v=>v.clientId===x.clientId)?'作廢同步中':'已作廢'):q.has(x.clientId)?'待上傳':'已上傳'}</td><td>${x.void?'':`<button class="warn vbtn" data-v="${esc(x.clientId)}">作廢</button>`}</td></tr>`).join('')}</table>
<p style="color:#888;font-size:14px">今日小計只算這台裝置的紀錄。作廢只加標記、不刪除後端資料；改品項請用 Pro 版。</p>`;
  $('#body').querySelectorAll('.vbtn').forEach(b=>b.onclick=()=>quickVoid(b.dataset.v))}
if('serviceWorker' in navigator&&!/^(localhost|127\.0\.0\.1)$/.test(location.hostname))navigator.serviceWorker.register('sw.js');
/* ===== L4：門市 4 位數 PIN 快速解鎖＋登入時效上限 12 小時 ===== */
const MAXH=12,IDLE=10*60e3;let lastAct=Date.now();
function touch(){lastAct=Date.now()}['pointerdown','keydown'].forEach(e=>addEventListener(e,touch,{passive:true}));
async function pinHash(pin,salt){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(salt+':'+S.username+':'+pin));return[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function pinPad(title,done,extra){app.innerHTML=`<div class="card login pin"><h2 style="margin:0">${title}</h2><div class="dots" id="dots"></div><div class="pad">${[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map(k=>k===''?'<span></span>':`<button data-k="${k}" class="${k==='⌫'?'sec':''}">${k}</button>`).join('')}</div><div id="err" style="color:#c0392b;min-height:1.4em"></div>${extra||''}</div>`;
  let v='';const show=()=>$('#dots').textContent='●'.repeat(v.length)+'○'.repeat(4-v.length);show();
  app.querySelector('.pad').onclick=e=>{const b=e.target.closest('[data-k]');if(!b)return;const k=b.dataset.k;if(k==='⌫')v=v.slice(0,-1);else if(v.length<4)v+=k;show();if(v.length===4){const x=v;v='';setTimeout(()=>{show();done(x)},120)}}}
function offerPin(next){if(!confirm('要為這台門市裝置設定 4 位數 PIN 嗎？\n設定後，閒置 10 分鐘或重新開啟時只要輸入 PIN 解鎖；登入最長 12 小時後仍需重新輸入密碼。'))return next();
  pinPad('設定 4 位數 PIN',a=>pinPad('再輸入一次確認',async b=>{if(a!==b){toast('兩次不一致，略過設定');return next()}
    if(/^(\d)\1{3}$|^(0123|1234|2345|3456|4567|5678|6789|9876|8765|7654|6543|5432|4321|3210)$/.test(a)){toast('PIN 太好猜，略過設定');return next()}
    const salt=uid('p');LS.s('pin_'+S.username,{salt,h:await pinHash(a,salt)});toast('✔ PIN 已設定');next()}))}
function lockView(){S.locked=true;LS.s('sess',S);$('#logout').hidden=true;pinPad(`${esc(S.storeName||'')}　輸入 PIN 解鎖`,async v=>{const P=LS.g('pin_'+S.username,null);if(!P)return loginView();
    if(await pinHash(v,P.salt)===P.h){P.bad=0;LS.s('pin_'+S.username,P);S.locked=false;LS.s('sess',S);start();flush();return}
    P.bad=(P.bad||0)+1;LS.s('pin_'+S.username,P);if(P.bad>=5){P.bad=0;LS.s('pin_'+S.username,P);S={username:S.username};LS.s('sess',S);toast('PIN 錯誤 5 次，請用密碼登入');return loginView()}
    $('#err').textContent=`PIN 錯誤（剩 ${5-P.bad} 次）`},`<button class="sec" id="pwlogin">改用密碼登入</button>`);
  $('#pwlogin').onclick=()=>{S={username:S.username};LS.s('sess',S);loginView()}}
function sessionOk(){return S.token&&!S.expired&&(!S.loginAt||Date.now()-S.loginAt<MAXH*3600e3)}
/* 後端每 6 小時清快取；有新版後端時，背景續約到登入後 12 小時為止（舊後端回「未知動作」就略過） */
async function renew(){if(MOCK||!S.token||S.expired||!S.loginAt||S.noRenew)return;if(Date.now()-(S.renewAt||S.loginAt)<4*3600e3)return;
  try{const r=await api('renew',{});if(r.token){S.token=r.token;S.renewAt=Date.now();LS.s('sess',S)}}catch(e){if(/未知動作/.test(e.message)){S.noRenew=true;LS.s('sess',S)}}}
setInterval(()=>{if(!S.token)return;if(!sessionOk()){if(!S.expired){S.expired=true;LS.s('sess',S);netUI();toast('登入已滿 12 小時，請重新輸入密碼');loginView()}return}
  if(!S.locked&&LS.g('pin_'+S.username,null)&&Date.now()-lastAct>IDLE)lockView();renew()},30e3);
if(sessionOk()){if(LS.g('pin_'+S.username,null))lockView();else start()}else{if(S.token){S.expired=true;LS.s('sess',S)}loginView()}netUI();flush();
