import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { randomUUID } from 'node:crypto';

const root = resolve(process.cwd());
const webDir = join(root, 'apps/web');
const dataDir = process.env.DATA_DIR || '/data';
const dataPath = join(dataDir, 'queue.json');
const port = Number(process.env.PORT || 3000);
await mkdir(dataDir, { recursive: true });
let state = { queue: [], nowPlaying: null, session: 'ABCD' };
if (existsSync(dataPath)) {
  try { const saved = JSON.parse(await readFile(dataPath, 'utf8')); state = { ...state, ...saved }; } catch { /* keep defaults */ }
}
const save = () => writeFile(dataPath, JSON.stringify(state, null, 2));
const send = (res, status, body) => { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' }); res.end(JSON.stringify(body)); };
const readBody = async req => { let raw=''; for await (const part of req) { raw += part; if(raw.length>4096) throw Error('Request too large'); } return JSON.parse(raw || '{}'); };
const youtubeId = url => { try { const u = new URL(url); const h = u.hostname.toLowerCase(); if(h==='youtu.be') return u.pathname.slice(1).split('/')[0]; if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'].includes(h)) return u.pathname.startsWith('/shorts/') ? u.pathname.split('/')[2] : u.searchParams.get('v'); } catch {} return null; };
const mime = {'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
http.createServer(async (req,res)=>{
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (req.method==='GET' && path==='/api/state') return send(res,200,state);
    if (req.method==='POST' && path==='/api/requests') {
      const input=await readBody(req);
      const id=youtubeId(input.url);
      if(!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return send(res,400,{error:'Enter a valid YouTube video URL'});
      const nickname=String(input.nickname||'Guest').trim().slice(0,32);
      if(state.queue.some(x=>x.videoId===id)) return send(res,409,{error:'This video is already in the queue'});
      if(state.queue.filter(x=>x.nickname===nickname).length>=3) return send(res,429,{error:'Maximum of three pending requests per nickname'});
      const item={id:randomUUID(),videoId:id,nickname,url:'https://www.youtube.com/watch?v='+id,submittedAt:new Date().toISOString(),status:'unverified'};
      state.queue.push(item); await save();
      return send(res,201,{item,warning:'Metadata moderation and automatic playback are not yet implemented'});
    }
    if (req.method!=='GET') return send(res,405,{error:'Method not allowed'});
    const filePath = path==='/app.js' ? join(webDir,'app.js') : path==='/style.css' ? join(webDir,'style.css') : join(webDir,'index.html');
    const content=await readFile(filePath);
    res.writeHead(200,{'Content-Type':mime[extname(filePath)]||'text/html; charset=utf-8','X-Content-Type-Options':'nosniff'}); res.end(content);
  } catch(err) { if(!res.headersSent) send(res,500,{error:'Server error'}); console.error(err); }
}).listen(port,'0.0.0.0',()=>console.log('YT Music Jukebox listening on '+port));
