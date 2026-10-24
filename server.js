// Tank game server. Run: node server.js   (game.html must lie next to this file)
const http=require('http'),crypto=require('crypto'),fs=require('fs'),vm=require('vm'),path=require('path');
const PORT=process.env.PORT||8080,GAME=path.join(__dirname,'game.html');
const OFFICIAL=[{name:'Основной сервер',map:'city',mode:'std',df:'med',bots:true,max:8}];
const rooms=new Map();let nid=1;
function send(ws,o){if(ws.dead)return;const b=Buffer.from(JSON.stringify(o)),n=b.length;let h;if(n<126)h=Buffer.from([0x81,n]);else if(n<65536){h=Buffer.alloc(4);h[0]=0x81;h[1]=126;h.writeUInt16BE(n,2)}else{h=Buffer.alloc(10);h[0]=0x81;h[1]=127;h.writeBigUInt64BE(BigInt(n),2)}try{ws.sock.write(Buffer.concat([h,b]))}catch(e){}}
function parse(ws){for(;;){const b=ws.buf;if(b.length<2)return;let len=b[1]&127,off=2;if(len===126){if(b.length<4)return;len=b.readUInt16BE(2);off=4}else if(len===127){if(b.length<10)return;len=Number(b.readBigUInt64BE(2));off=10}
 const mk=(b[1]&128)?4:0;if(b.length<off+mk+len)return;const mask=mk?b.slice(off,off+4):null,p=Buffer.from(b.slice(off+mk,off+mk+len));if(mask)for(let i=0;i<len;i++)p[i]^=mask[i&3];const op=b[0]&15;ws.buf=b.slice(off+mk+len);
 if(op===8){ws.sock.end();return}if(op===9){ws.sock.write(Buffer.concat([Buffer.from([0x8a,p.length]),p]));continue}if(op===1){try{onmsg(ws,JSON.parse(p.toString()))}catch(e){console.error(e)}}}}
function info(r){return{id:r.id,name:r.name,off:r.off?1:0,n:r.peers.size+(r.off?0:1),max:r.cfg.max,map:r.cfg.map,mode:r.cfg.mode}}
function toHost(r,m){if(r.off)r.hl.hostMsg(m);else send(r.host,m)}
function fromHost(r,m){if(m.to!=null){const p=r.peers.get(m.to);if(p)send(p,m)}else r.peers.forEach(p=>send(p,m))}
function onmsg(ws,m){
 if(m.t==='list')return send(ws,{t:'rooms',list:[...rooms.values()].map(info)});
 if(m.t==='create'){const c=m.cfg||{};const r={id:'c'+nid++,name:String(c.name||'Сервер').slice(0,24),off:false,host:ws,peers:new Map(),pn:1,cfg:{name:'',map:c.map,mode:c.mode,df:c.df,bots:!!c.bots,max:8}};r.cfg.name=r.name;rooms.set(r.id,r);ws.room=r;ws.host=true;return send(ws,{t:'hosted',id:r.id})}
 if(m.t==='join'){const r=rooms.get(m.id);if(!r)return send(ws,{t:'err',e:'Комната закрыта'});if(r.peers.size+(r.off?0:1)>=r.cfg.max)return send(ws,{t:'err',e:'Нет мест'});const pid=r.pn++;ws.room=r;ws.pid=pid;r.peers.set(pid,ws);send(ws,{t:'joined',id:r.id,pid,cfg:r.cfg});return toHost(r,{t:'peer+',pid,name:m.name,tank:m.tank,lv:m.lv})}
 const r=ws.room;if(!r)return;
 if(ws.host)return fromHost(r,m);
 m.pid=ws.pid;toHost(r,m)}
function drop(ws){if(ws.dead)return;ws.dead=true;const r=ws.room;if(!r)return;if(ws.host){rooms.delete(r.id);r.peers.forEach(p=>send(p,{t:'closed'}))}else{r.peers.delete(ws.pid);toHost(r,{t:'peer-',pid:ws.pid})}}
const srv=http.createServer((q,res)=>{try{res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(q.url==='/health'?'ok':fs.readFileSync(GAME))}catch(e){res.end('ok')}});
srv.on('upgrade',(q,sock)=>{const k=q.headers['sec-websocket-key'];if(!k)return sock.destroy();sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+crypto.createHash('sha1').update(k+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')+'\r\n\r\n');
 const ws={sock,buf:Buffer.alloc(0),dead:false,room:null,pid:null,host:false};sock.on('data',d=>{ws.buf=Buffer.concat([ws.buf,d]);parse(ws)});sock.on('close',()=>drop(ws));sock.on('error',()=>drop(ws))});
// ---- official rooms: the game itself runs headless here (server is authoritative) ----
function startOfficial(cfg){
 let code;try{code=/<script>([\s\S]*?)<\/script>/.exec(fs.readFileSync(GAME,'utf8'))[1]}catch(e){console.error('game.html not found');return}
 const r={id:'o'+nid++,name:cfg.name,off:true,peers:new Map(),pn:1,cfg};rooms.set(r.id,r);
 const P=(()=>{const mk=()=>{const st={};const f=function(){};return new Proxy(f,{get(_,k){if(k===Symbol.toPrimitive)return()=>0;if(k==='then')return undefined;if(!(k in st))st[k]=mk();return st[k]},set(_,k,v){st[k]=v;return true},apply(){return mk()},construct(){return mk()}})};return mk})();
 let raf=null,T=0;const g={console,setTimeout,clearTimeout,setInterval,clearInterval,HEADLESS:cfg,devicePixelRatio:1,innerWidth:1280,innerHeight:720,
  document:P(),THREE:P(),localStorage:{getItem:()=>null,setItem(){}},matchMedia:()=>({matches:false}),performance:{now:()=>T},
  requestAnimationFrame:f=>{raf=f},addEventListener(){},removeEventListener(){},navigator:{userAgent:'node'},location:{search:''},
  __send:m=>fromHost(r,m)};
 g.window=g;const ctx=vm.createContext(g);
 try{vm.runInContext(code,ctx)}catch(e){console.error('headless init failed',e);return}
 r.hl={hostMsg:m=>{try{ctx.hostMsg(m)}catch(e){console.error(e)}}};
 setInterval(()=>{if(r.peers.size===0||!raf)return;T+=50;try{raf(T)}catch(e){console.error(e.message)}},50);
 console.log('official room up:',cfg.name)}
srv.listen(PORT,()=>{console.log('listening',PORT);OFFICIAL.forEach(startOfficial)});
