import http from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve,extname} from 'node:path';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import YAML from 'yaml';
import QRCode from 'qrcode';

const root=resolve(process.cwd()),webDir=join(root,'apps/web'),dataDir=process.env.DATA_DIR||'/data';
await mkdir(dataDir,{recursive:true});
const settingsPath=join(dataDir,'config.yaml'),statePath=join(dataDir,'state.json');
const defaultConfig=YAML.parse(await readFile(join(root,'config/default.yaml'),'utf8'));
let settings=existsSync(settingsPath)?YAML.parse(await readFile(settingsPath,'utf8')):defaultConfig;
if(!existsSync(settingsPath)) await writeFile(settingsPath,YAML.stringify(settings));
const wordList=(await readFile(join(root,'config/profanity-words.txt'),'utf8')).split(/\r?\n/).map(x=>x.trim().toLowerCase()).filter(x=>x&&!x.startsWith('#'));
let state={queue:[],nowPlaying:null,messages:[],session:randomUUID().slice(0,8)};
if(existsSync(statePath)){try{state={...state,...JSON.parse(await readFile(statePath,'utf8'))};}catch{}}
const save=()=>writeFile(statePath,JSON.stringify(state,null,2));
const send=(res,status,data,type='application/json; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(type.startsWith('application/json')?JSON.stringify(data):data);};
const body=async req=>{let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>20000)throw Error('Body too large');}return JSON.parse(raw||'{}');};
const token=process.env.ADMIN_TOKEN||'';
const authorized=req=>{const supplied=String(req.headers.authorization||'').replace(/^Bearer /,'');return token.length>=16&&supplied.length===token.length&&timingSafeEqual(Buffer.from(supplied),Buffer.from(token));};
const idFromUrl=value=>{try{const u=new URL(value),h=u.hostname.toLowerCase();if(h==='youtu.be')return u.pathname.split('/')[1];if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'].includes(h))return u.pathname.startsWith('/shorts/')?u.pathname.split('/')[2]:u.searchParams.get('v');}catch{}return null;};
const normalize=s=>s.toLowerCase().replace(/[@]/g,'a').replace(/[0]/g,'o').replace(/[1!]/g,'i').replace(/[3]/g,'e').replace(/[4]/g,'a').replace(/[5$]/g,'s').replace(/[7]/g,'t');
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function cleanMessage(message){
  const p=settings.chat?.profanity||{};
  if(!p.enabled)return {text:message,blocked:false};
  const allowed=new Set((p.allow_words||[]).map(x=>x.toLowerCase()));
  const words=[...new Set([...wordList,...(p.extra_words||[])].map(x=>x.toLowerCase()))].filter(x=>!allowed.has(x));
  let filtered=message,matched=false;
  for(const w of words){if(!w)continue;const re=new RegExp('(^|[^a-z0-9])('+escape(w).replace(/\\\*/g,'[a-z*]')+')(?=$|[^a-z0-9])','gi');
    filtered=filtered.replace(re,(whole,prefix,word)=>{matched=true;return prefix+(p.replacement||'***');});
  }
  // Common numeric substitutions are checked separately to catch simple evasions.
  const normalized=normalize(message);
  if(words.some(w=>w.length>=4&&new RegExp('(^|[^a-z0-9])'+escape(normalize(w))+'(?=$|[^a-z0-9])').test(normalized)))matched=true;
  if(matched&&p.action==='reject')return {text:'',blocked:true};
  if(matched&&filtered===message)return {text:p.replacement||'***',blocked:false};
  return {text:filtered,blocked:false};
}
const publicSettings=()=>({youtube:settings.youtube,requests:settings.requests,chat:{enabled:settings.chat.enabled,mode:settings.chat.mode,max_length:settings.chat.max_length},player:settings.player});
const publicState=()=>({...state,settings:publicSettings()});
const lastPost=new Map();
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost'),path=url.pathname;
    if(req.method==='GET'&&path==='/api/state')return send(res,200,publicState());
    if(req.method==='GET'&&path==='/api/qr'){
      const base=String(url.searchParams.get('base')||'');
      const u=new URL(base);
      if(!['http:','https:'].includes(u.protocol)||u.pathname!=='/join')return send(res,400,{error:'Invalid join URL'});
      return send(res,200,await QRCode.toString(u.toString(),{type:'svg',margin:1,width:240}),'image/svg+xml');
    }
    if(req.method==='POST'&&path==='/api/requests'){
      if(!settings.requests.enabled)return send(res,403,{error:'Requests are disabled'});
      const b=await body(req),id=idFromUrl(b.url);
      if(!id||!/^[\w-]{11}$/.test(id))return send(res,400,{error:'Invalid YouTube URL'});
      const nickname=String(b.nickname||'').trim().slice(0,32);
      if(!nickname)return send(res,400,{error:'Nickname required'});
      if(state.queue.some(x=>x.videoId===id)||state.nowPlaying?.videoId===id)return send(res,409,{error:'Already queued or playing'});
      if(state.queue.filter(x=>x.nickname.toLowerCase()===nickname.toLowerCase()).length>=settings.requests.max_pending_per_guest)return send(res,429,{error:'Request limit reached'});
      const item={id:randomUUID(),videoId:id,nickname,url:'https://www.youtube.com/watch?v='+id,title:'YouTube video '+id,submittedAt:new Date().toISOString(),status:'unverified'};
      state.queue.push(item);await save();return send(res,201,{item,warning:'Metadata verification is not yet available'});
    }
    if(req.method==='POST'&&path==='/api/messages'){
      if(!settings.chat.enabled)return send(res,403,{error:'Chat disabled'});
      const b=await body(req),nickname=String(b.nickname||'Guest').trim().slice(0,32)||'Guest';
      const message=String(b.message||'').trim().slice(0,settings.chat.max_length||240);
      if(!message)return send(res,400,{error:'Message required'});
      const mode=String(b.mode||'live');
      if(!['live','song'].includes(mode)||settings.chat.mode!=='both'&&settings.chat.mode!==mode)return send(res,403,{error:'Chat mode disabled'});
      const ip=req.socket.remoteAddress||'unknown',now=Date.now(),cooldown=(settings.chat.cooldown_seconds||5)*1000;
      if(now-(lastPost.get(ip)||0)<cooldown)return send(res,429,{error:'Please wait before posting again'});
      const filtered=cleanMessage(message);
      if(filtered.blocked)return send(res,422,{error:'Message contains blocked language'});
      const entry={id:randomUUID(),nickname,message:filtered.text,mode,videoId:mode==='song'?state.nowPlaying?.videoId||null:null,at:new Date().toISOString()};
      if(mode==='song'&&!entry.videoId)return send(res,400,{error:'No song is playing'});
      lastPost.set(ip,now);state.messages.push(entry);state.messages=state.messages.slice(-(settings.chat.max_messages||100));await save();return send(res,201,entry);
    }
    if(path==='/api/admin/config'&&req.method==='GET'){
      if(!authorized(req))return send(res,401,{error:'Admin token required'});
      return send(res,200,{yaml:YAML.stringify(settings)});
    }
    if(path==='/api/admin/config'&&req.method==='PUT'){
      if(!authorized(req))return send(res,401,{error:'Admin token required'});
      const b=await body(req);let next;
      try{next=YAML.parse(String(b.yaml||''));if(!next||!next.player||!next.chat||!next.requests||!next.youtube||!next.filters)throw Error('Missing required configuration sections');}catch(e){return send(res,400,{error:'Invalid configuration: '+e.message});}
      await writeFile(settingsPath,YAML.stringify(next));settings=next;return send(res,200,{ok:true});
    }
    if(path==='/api/admin/advance'&&req.method==='POST'){
      if(!authorized(req))return send(res,401,{error:'Admin token required'});
      state.nowPlaying=state.queue.shift()||null;await save();return send(res,200,publicState());
    }
    if(path==='/api/admin/messages'&&req.method==='DELETE'){
      if(!authorized(req))return send(res,401,{error:'Admin token required'});
      state.messages=[];await save();return send(res,200,{ok:true});
    }
    if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
    const file=path==='/app.js'?join(webDir,'app.js'):path==='/style.css'?join(webDir,'style.css'):join(webDir,'index.html');
    const content=await readFile(file);return send(res,200,content,mime[extname(file)]||'text/html; charset=utf-8');
  }catch(e){console.error(e);if(!res.headersSent)send(res,500,{error:'Server error'});}
}).listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('YT Music Jukebox started'));
