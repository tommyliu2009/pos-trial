/* ===== 進階分析（全部在瀏覽器端計算，不需改後端） ===== */
const PAYS=['現金','LINE Pay','街口支付','悠遊卡','其他'];
const payOf=x=>{const p=String(x.clientId||'').split('|')[1];return p||'現金'};
let _rec=null,_recT=0;
async function allRecords(force){if(force||!_rec||Date.now()-_recT>300000){_rec=await api('records',{prefix:''});_recT=Date.now()}return _rec}
const costKey=st=>'cost_'+st;const getCost=st=>JSON.parse(localStorage.getItem(costKey(st))||'{}');
const ymd=d=>d.toLocaleDateString('sv');const addD=(s,n)=>{const d=new Date(s+'T00:00:00');d.setDate(d.getDate()+n);return ymd(d)};
const wkStart=s=>{const d=new Date(s+'T00:00:00');d.setDate(d.getDate()-((d.getDay()+6)%7));return ymd(d)};
const pct=(a,b)=>b?((a-b)/b*100).toFixed(1)+'%':'—';
function bars(data,h=160,color='#1f6f5c'){if(!data.length)return'<p>無資料</p>';const mx=Math.max(...data.map(d=>d[1]),1),w=Math.max(4,Math.min(40,900/data.length));
  return`<div style="overflow-x:auto"><svg width="${data.length*(w+2)+40}" height="${h+40}" style="font-size:11px">${data.map((d,i)=>{const bh=d[1]/mx*h;return`<g><title>${esc(d[0])}：${money(d[1])}</title><rect x="${i*(w+2)}" y="${h-bh+5}" width="${w}" height="${bh}" fill="${d[2]||color}"/>${data.length<=31||i%Math.ceil(data.length/15)==0?`<text x="${i*(w+2)}" y="${h+20}">${esc(String(d[0]).slice(-5))}</text>`:''}</g>`}).join('')}</svg></div>`}
function hbar(rows){const mx=Math.max(...rows.map(r=>r[1]),1);return rows.map(r=>`<div class="row" style="margin:2px 0"><span style="flex:0 0 140px">${esc(r[0])}</span><span><span style="display:inline-block;height:16px;background:${r[2]||'#1f6f5c'};width:${r[1]/mx*100}%"></span> ${r[3]||money(r[1])}</span></div>`).join('')}
async function anaTab(storeId,sel){const r=await allRecords();const t=today();const st=storeId?(r.stores.find(s=>s.id===storeId)||{}).name||S.storeName:'全部店家';
  const from=$('#af')?.value||t.slice(0,4)+'-01-01',to=$('#at')?.value||t,gran=$('#ag')?.value||'month';
  const inS=x=>!storeId||x.storeId===storeId;const ok=x=>inS(x)&&!tb(x.void);
  const allS=r.sales.filter(ok),allE=r.expenses.filter(ok);const inR=x=>{const d=ld(x.time);return d>=from&&d<=to};
  const sales=allS.filter(inR),exps=allE.filter(inR);const voids=r.sales.filter(x=>inS(x)&&tb(x.void)&&inR(x)).length;
  const rev=sales.reduce((a,x)=>a+ +x.total,0),out=exps.reduce((a,x)=>a+ +x.amount,0),n=sales.length,atv=n?rev/n:0;
  const lines=sales.flatMap(x=>JSON.parse(x.lines).map(l=>({...l,storeId:x.storeId})));
  const items={};lines.forEach(l=>{const k=l.storeId+'|'+l.name;const o=items[k]=items[k]||{name:l.name,storeId:l.storeId,id:l.id,q:0,amt:0,price:l.price};o.q+=l.qty;o.amt+=l.qty*l.price});
  const ranked=Object.values(items).sort((a,b)=>b.amt-a.amt);let cum=0;ranked.forEach(o=>{cum+=o.amt;o.cls=cum/rev<=.8?'A':cum/rev<=.95?'B':'C'});if(ranked[0])ranked[0].cls='A';
  const costs={};r.stores.forEach(s=>Object.assign(costs,Object.fromEntries(Object.entries(getCost(s.id)).map(([k,v])=>[s.id+'|'+k,v]))));
  let cogs=0;ranked.forEach(o=>{o.cr=costs[o.storeId+'|'+o.name]??40;o.gp=o.amt*(1-o.cr/100);cogs+=o.amt*o.cr/100});
  // 趨勢
  const key=d=>gran==='day'?d:gran==='week'?wkStart(d):d.slice(0,7);const tr={};sales.forEach(x=>{const k=key(ld(x.time));tr[k]=(tr[k]||0)+ +x.total});
  if(gran==='day')for(let d=from;d<=to;d=addD(d,1))tr[d]=tr[d]||0;const trend=Object.keys(tr).sort().map(k=>[k,tr[k]]);
  // 月份收支
  const M={};allS.forEach(x=>{const m=ld(x.time).slice(0,7);(M[m]=M[m]||{i:0,o:0,n:0}).i+= +x.total;M[m].n++});allE.forEach(x=>{const m=ld(x.time).slice(0,7);(M[m]=M[m]||{i:0,o:0,n:0}).o+= +x.amount});
  const months=Object.keys(M).sort();const cm=t.slice(0,7),pm=months.filter(m=>m<cm).pop(),ly=(+cm.slice(0,4)-1)+cm.slice(4);
  // 同期比較：本月至今 vs 上月同期 vs 去年同期
  const dom=+t.slice(8);const mtd=m=>m?allS.filter(x=>{const d=ld(x.time);return d.startsWith(m)&&+d.slice(8)<=dom}).reduce((a,x)=>a+ +x.total,0):0;
  const cur=mtd(cm),prev=mtd(pm),lyv=mtd(ly);
  // 預測：近 3 個完整月加權移動平均 × 趨勢
  const full=months.filter(m=>m<cm).slice(-3).map(m=>M[m].i);const fc=full.length?Math.round(full.reduce((a,v,i)=>a+v*(i+1),0)/full.reduce((a,v,i)=>a+i+1,0)*(full.length>1?Math.min(1.2,Math.max(.8,full[full.length-1]/full[0]))**(1/(full.length-1)):1)):0;
  const nm=(()=>{const d=new Date(cm+'-01T00:00:00');d.setMonth(d.getMonth()+1);return ymd(d).slice(0,7)})();
  const mPace=dom?Math.round(cur/dom*new Date(+cm.slice(0,4),+cm.slice(5),0).getDate()):0;
  // 熱力圖
  const H=Array.from({length:7},()=>Array(24).fill(0));sales.forEach(x=>{const d=new Date(x.time);H[(d.getDay()+6)%7][d.getHours()]+= +x.total});
  const hrs=[...Array(24).keys()].filter(h=>H.some(r=>r[h]));const hmx=Math.max(...H.flat(),1);
  const wd=['一','二','三','四','五','六','日'];
  // 付款方式
  const P={};sales.forEach(x=>{const p=payOf(x);(P[p]=P[p]||{a:0,n:0}).a+= +x.total;P[p].n++});
  // 店家比較
  const storeRows=storeId?[]:r.stores.map(s=>{const a=sales.filter(x=>x.storeId===s.id),e=exps.filter(x=>x.storeId===s.id),i=a.reduce((p,x)=>p+ +x.total,0),o=e.reduce((p,x)=>p+ +x.amount,0);return{n:s.name,i,o,c:a.length,atv:a.length?i/a.length:0}}).sort((a,b)=>b.i-a.i);
  window._ana=()=>anaTab(storeId,sel);window._anaR=async()=>{await allRecords(true);_ana()};
  window._anaX=k=>{const nm2=`${st}_${from}_${to}`;({
    trend:()=>csv(nm2+'_銷售趨勢',[['期間','營業收入'],...trend]),
    items:()=>csv(nm2+'_商品排行ABC',[['排名','店家','品項','數量','營收','佔比','ABC','估計成本率%','估計毛利'],...ranked.map((o,i)=>[i+1,(r.stores.find(s=>s.id===o.storeId)||{}).name,o.name,o.q,o.amt,(o.amt/rev*100).toFixed(1)+'%',o.cls,o.cr,Math.round(o.gp)])]),
    month:()=>csv(st+'_每月收支損益',[['月份','營業收入','支出','淨利','交易筆數','客單價'],...months.map(m=>[m,M[m].i,M[m].o,M[m].i-M[m].o,M[m].n,Math.round(M[m].i/(M[m].n||1))])]),
    pay:()=>csv(nm2+'_付款方式',[['付款方式','金額','筆數','佔比'],...Object.entries(P).map(([k,v])=>[k,v.a,v.n,(v.a/rev*100).toFixed(1)+'%'])]),
    heat:()=>csv(nm2+'_時段熱力',[['星期',...hrs.map(h=>h+'時')],...H.map((row,i)=>['週'+wd[i],...hrs.map(h=>row[h])])])})[k]()};
  window._cost=(sid,name,v)=>{const c=getCost(sid);c[name]=+v;localStorage.setItem(costKey(sid),JSON.stringify(c));_ana()};
  const sname=id=>(r.stores.find(s=>s.id===id)||{}).name||'';const abcC={A:'#1f6f5c',B:'#e0a800',C:'#c0392b'};
  $(sel).innerHTML=`<div class="card"><h3>進階分析｜${esc(st)}</h3><div class="row"><span>起</span><input type="date" id="af" value="${from}" onchange="_ana()"><span>迄</span><input type="date" id="at" value="${to}" onchange="_ana()"><select id="ag" onchange="_ana()">${[['day','日'],['week','週'],['month','月']].map(([k,v])=>`<option value="${k}" ${k===gran?'selected':''}>依${v}</option>`).join('')}</select><button class="sec" onclick="_anaR()">重新讀取</button></div>
  <span class="stat">營業收入<b>${money(rev)}</b></span><span class="stat">交易筆數<b>${n.toLocaleString()}</b></span><span class="stat">客單價<b>${money(atv)}</b></span><span class="stat">支出<b>${money(out)}</b></span><span class="stat">淨利<b style="color:${rev-out<0?'#c0392b':''}">${money(rev-out)}</b></span><span class="stat">估計毛利率<b>${rev?((1-cogs/rev)*100).toFixed(1)+'%':'—'}</b></span><span class="stat">作廢單<b>${voids}</b></span></div>
  <div class="card"><h3>銷售趨勢 <button class="sec" onclick="_anaX('trend')">匯出</button></h3>${bars(trend)}</div>
  <div class="card"><h3>同期比較與預測</h3><table><tr><th>項目</th><th>金額</th><th>差異</th></tr><tr><td>本月至今（${cm}，1–${dom} 日）</td><td>${money(cur)}</td><td></td></tr><tr><td>上月同期（${pm||'—'}）</td><td>${money(prev)}</td><td>月增 MoM ${pct(cur,prev)}</td></tr><tr><td>去年同期（${ly}）</td><td>${lyv?money(lyv):'無資料'}</td><td>年增 YoY ${lyv?pct(cur,lyv):'—（尚無去年資料）'}</td></tr>
  <tr><td>本月推估（依目前速度）</td><td>${money(mPace)}</td><td></td></tr><tr><td><b>下月預測（${nm}）</b></td><td><b>${money(fc)}</b></td><td><small>近 3 個完整月加權移動平均×趨勢，僅供參考</small></td></tr></table></div>
  <div class="card"><h3>每月收入、支出與淨利 <button class="sec" onclick="_anaX('month')">匯出</button></h3>${bars(months.flatMap(m=>[[m+' 收',M[m].i,'#1f6f5c'],[m+' 支',M[m].o,'#e67e22']]))}<table><tr><th>月份</th><th>收入</th><th>支出</th><th>淨利</th><th>筆數</th><th>客單價</th><th>MoM</th></tr>${months.map((m,i)=>`<tr><td>${m}</td><td>${money(M[m].i)}</td><td>${money(M[m].o)}</td><td style="color:${M[m].i-M[m].o<0?'#c0392b':''}">${money(M[m].i-M[m].o)}</td><td>${M[m].n}</td><td>${money(M[m].i/(M[m].n||1))}</td><td>${i?pct(M[m].i,M[months[i-1]].i):''}</td></tr>`).join('')}</table></div>
  ${storeId?'':`<div class="card"><h3>店家比較（區間內）</h3>${hbar(storeRows.map(x=>[x.n,x.i,'#1f6f5c',`${money(x.i)}・${x.c} 筆・客單 ${money(x.atv)}・淨利 ${money(x.i-x.o)}`]))}</div>`}
  <div class="card"><h3>商品排行與 ABC 分析 <button class="sec" onclick="_anaX('items')">匯出</button></h3><small>A＝累計前 80% 營收的主力商品；B＝次要；C＝滯銷（後 5%），可考慮調整或下架。成本率為估計值，可直接修改（只存在這台裝置）。</small>
  <table><tr><th>#</th>${storeId?'':'<th>店家</th>'}<th>品項</th><th>數量</th><th>營收</th><th>佔比</th><th>ABC</th><th>成本率%</th><th>估計毛利</th></tr>${ranked.map((o,i)=>`<tr><td>${i+1}</td>${storeId?'':`<td>${esc(sname(o.storeId))}</td>`}<td>${esc(o.name)}</td><td>${o.q}</td><td>${money(o.amt)}</td><td>${(o.amt/rev*100).toFixed(1)}%</td><td><b style="color:${abcC[o.cls]}">${o.cls}</b></td><td><input type="number" style="width:70px;padding:4px" value="${o.cr}" onchange="_cost('${o.storeId}','${esc(o.name)}',this.value)"></td><td>${money(o.gp)}</td></tr>`).join('')}</table>
  <p><b>熱銷前 3：</b>${ranked.slice(0,3).map(o=>esc(o.name)).join('、')||'—'}　<b>滯銷後 3：</b>${ranked.slice(-3).reverse().map(o=>esc(o.name)).join('、')||'—'}</p></div>
  <div class="card"><h3>星期×時段熱力圖（營收） <button class="sec" onclick="_anaX('heat')">匯出</button></h3><div style="overflow-x:auto"><table style="font-size:13px"><tr><th></th>${hrs.map(h=>`<th>${h}時</th>`).join('')}</tr>${H.map((row,i)=>`<tr><th>週${wd[i]}</th>${hrs.map(h=>`<td title="${money(row[h])}" style="background:rgba(31,111,92,${(row[h]/hmx).toFixed(2)});color:${row[h]/hmx>.5?'#fff':'#333'};text-align:center">${row[h]?Math.round(row[h]/1000)+'k':''}</td>`).join('')}</tr>`).join('')}</table></div></div>
  <div class="card"><h3>付款方式 <button class="sec" onclick="_anaX('pay')">匯出</button></h3>${hbar(Object.entries(P).sort((a,b)=>b[1].a-a[1].a).map(([k,v])=>[k,v.a,'#2e86c1',`${money(v.a)}・${v.n} 筆・${(v.a/rev*100).toFixed(1)}%`]))}</div>`}
