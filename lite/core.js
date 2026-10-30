/* POS 核心邏輯：瀏覽器測試模式與 Apps Script 共用（同一份程式） */
var TABLES={stores:['id','name','active','created'],items:['id','storeId','name','price','active'],sales:['id','storeId','time','account','lines','total','paid','change','void','voidBy','clientId'],expenses:['id','storeId','time','account','category','note','amount','void','voidBy','clientId'],accounts:['username','salt','hash','role','storeId','active'],audit:['time','account','action','detail']};
var SHEET_NAMES={stores:'店家',items:'品項',sales:'銷售',expenses:'支出',accounts:'帳號',audit:'稽核紀錄'};
function sha256(s){function r(n,x){return(x>>>n)|(x<<(32-n))}var K=[],H=[],p=2,c=0;function ip(n){for(var f=2;f*f<=n;f++)if(n%f==0)return 0;return 1}while(c<64){if(ip(p)){if(c<8)H[c]=(Math.pow(p,1/2)*4294967296)|0;K[c++]=(Math.pow(p,1/3)*4294967296)|0}p++}
var b=unescape(encodeURIComponent(s)),w=[],l=b.length*8,i,j;for(i=0;i<b.length;i++)w[i>>2]|=b.charCodeAt(i)<<((3-i)%4)*8;w[l>>5]|=0x80<<(24-l%32);w[((l+64>>9)<<4)+15]=l;
for(j=0;j<w.length;j+=16){var a=H.slice(0),W=[];for(i=0;i<64;i++){if(i<16)W[i]=w[j+i]|0;else{var x=W[i-15],y=W[i-2];W[i]=(W[i-16]+(r(7,x)^r(18,x)^(x>>>3))+W[i-7]+(r(17,y)^r(19,y)^(y>>>10)))|0}
var t1=a[7]+(r(6,a[4])^r(11,a[4])^r(25,a[4]))+((a[4]&a[5])^(~a[4]&a[6]))+K[i]+W[i],t2=(r(2,a[0])^r(13,a[0])^r(22,a[0]))+((a[0]&a[1])^(a[0]&a[2])^(a[1]&a[2]));a=[(t1+t2)|0].concat(a);a[4]=(a[4]+t1)|0;a.pop()}for(i=0;i<8;i++)H[i]=(H[i]+a[i])|0}
var o='';for(i=0;i<8;i++)for(var k=3;k>=0;k--)o+=('0'+((H[i]>>>(k*8))&255).toString(16)).slice(-2);return o}
function uid(p){return p+Date.now().toString(36)+Math.random().toString(36).slice(2,7)}
function now(){return new Date().toISOString()}
function mkAcc(u,pw,role,storeId){var salt=uid('s');return{username:u,salt:salt,hash:sha256(salt+':'+pw),role:role,storeId:storeId||'',active:true}}
function audit(db,acc,action,detail){db.audit.push({time:now(),account:acc,action:action,detail:JSON.stringify(detail)})}
function tb(v){return v===true||v==='TRUE'||v==='true'}
/* sessions: {token:{username,role,storeId,exp}} 由外部提供儲存 */
function handle(db,sess,req){
  var a=req.action,p=req.payload||{};
  if(a==='login'){var acc=db.accounts.filter(function(x){return x.username===p.username&&tb(x.active)})[0];
    if(!acc||sha256(acc.salt+':'+p.password)!==acc.hash){audit(db,p.username||'?','登入失敗',{});return{ok:false,error:'帳號或密碼錯誤'}}
    if(acc.role==='store'){var st=db.stores.filter(function(s){return s.id===acc.storeId})[0];if(!st||!tb(st.active))return{ok:false,error:'此店家已停用'}}
    var tok=uid('t')+uid('');sess.set(tok,{username:acc.username,role:acc.role,storeId:acc.storeId,exp:Date.now()+12*3600e3});audit(db,acc.username,'登入',{});
    return{ok:true,token:tok,role:acc.role,storeId:acc.storeId,username:acc.username,storeName:(db.stores.filter(function(s){return s.id===acc.storeId})[0]||{}).name||''}}
  var s=sess.get(req.token);if(!s||s.exp<Date.now())return{ok:false,error:'登入逾時，請重新登入',relogin:true};
  var admin=s.role==='admin';
  function sid(){if(admin)return p.storeId;return s.storeId}
  function need(){if(!admin)throw new Error('沒有權限')}
  function own(r){if(!admin&&r.storeId!==s.storeId)throw new Error('沒有權限')}
  switch(a){
  case 'logout':sess.del(req.token);return{ok:true};
  case 'items':return{ok:true,items:db.items.filter(function(i){return i.storeId===sid()})};
  case 'saveItem':var it=p.id?db.items.filter(function(i){return i.id===p.id})[0]:null;
    if(!(p.name&&+p.price>=0))throw new Error('品名與價格必填');
    if(it){own(it);it.name=p.name;it.price=+p.price;it.active=p.active!==false}else{it={id:uid('i'),storeId:sid(),name:p.name,price:+p.price,active:true};db.items.push(it)}
    audit(db,s.username,'品項儲存',it);return{ok:true,item:it};
  case 'sale':if(db.sales.some(function(x){return x.clientId&&x.clientId===p.clientId}))return{ok:true,dup:true};
    var tot=0;p.lines.forEach(function(l){tot+=l.price*l.qty});
    var sa={id:uid('S'),storeId:sid(),time:p.time||now(),account:s.username,lines:JSON.stringify(p.lines),total:tot,paid:+p.paid||tot,change:(+p.paid||tot)-tot,void:false,voidBy:'',clientId:p.clientId||''};
    db.sales.push(sa);audit(db,s.username,'銷售',{id:sa.id,total:tot});return{ok:true,sale:sa};
  case 'expense':if(db.expenses.some(function(x){return x.clientId&&x.clientId===p.clientId}))return{ok:true,dup:true};
    if(!(+p.amount>0))throw new Error('金額必填');
    var ex={id:uid('E'),storeId:sid(),time:p.time||now(),account:s.username,category:p.category||'雜支',note:p.note||'',amount:+p.amount,void:false,voidBy:'',clientId:p.clientId||''};
    db.expenses.push(ex);audit(db,s.username,'支出',{id:ex.id,amount:ex.amount});return{ok:true,expense:ex};
  case 'void':var t=(p.kind==='sale'?db.sales:db.expenses).filter(function(x){return x.id===p.id})[0];if(!t)throw new Error('找不到');own(t);
    t.void=true;t.voidBy=s.username+' '+now()+' '+(p.reason||'');audit(db,s.username,'作廢',{id:p.id,reason:p.reason});return{ok:true};
  case 'records':var f=function(x){return(admin&&!p.storeId||x.storeId===sid())&&String(x.time).slice(0,p.prefix.length)===p.prefix};
    return{ok:true,sales:db.sales.filter(f),expenses:db.expenses.filter(f),stores:db.stores};
  case 'stores':need();return{ok:true,stores:db.stores,accounts:db.accounts.map(function(x){return{username:x.username,role:x.role,storeId:x.storeId,active:x.active}})};
  case 'saveStore':need();var st=p.id?db.stores.filter(function(x){return x.id===p.id})[0]:null;
    if(st){st.name=p.name||st.name;if(p.active!==undefined)st.active=p.active}else{st={id:uid('st'),name:p.name,active:true,created:now()};db.stores.push(st)}
    audit(db,s.username,'店家儲存',st);return{ok:true,store:st};
  case 'setAccount':need();if(!p.username||!p.password||p.password.length<6)throw new Error('帳號必填、密碼至少 6 碼');
    var ex2=db.accounts.filter(function(x){return x.username===p.username})[0];var n=mkAcc(p.username,p.password,p.role||'store',p.storeId);
    if(ex2){if(ex2.role!==n.role||ex2.storeId!==n.storeId)throw new Error('帳號已被其他店家使用');ex2.salt=n.salt;ex2.hash=n.hash;ex2.active=true}else db.accounts.push(n);
    audit(db,s.username,'設定帳號',{username:p.username,storeId:p.storeId});return{ok:true};
  case 'auditLog':need();return{ok:true,audit:db.audit.slice(-300).reverse()};
  }
  return{ok:false,error:'未知動作'}}
function seed(db,pw){
  db.stores.push({id:'st1',name:'林內驛站（示範假資料）',active:true,created:now()},{id:'st2',name:'古坑咖啡合作社（示範假資料）',active:true,created:now()},{id:'st3',name:'苗栗桂妃油茶（示範假資料）',active:true,created:now()});
  [['st1','香菇肉燥飯',45],['st1','雞腿便當',100],['st1','炒米粉',50],['st1','貢丸湯',30],['st1','古早味紅茶',25],['st1','花生糖',80],
   ['st2','古坑美式咖啡',60],['st2','古坑拿鐵',80],['st2','冰滴咖啡',90],['st2','咖啡豆半磅',350],['st2','濾掛咖啡10入',250],['st2','咖啡蛋糕',70],
   ['st3','苦茶油 250ml',450],['st3','苦茶油 500ml',850],['st3','油茶麵線',180],['st3','油茶籽洗髮精',380],['st3','苦茶油禮盒',1200]].forEach(function(r,i){db.items.push({id:'i'+i,storeId:r[0],name:r[1],price:r[2],active:true})});
  db.accounts.push(mkAcc('admin',pw.admin,'admin',''),mkAcc('linnei',pw.linnei,'store','st1'),mkAcc('gukeng',pw.gukeng,'store','st2'),mkAcc('guifei',pw.guifei,'store','st3'));
  audit(db,'system','建立示範資料',{});
}
