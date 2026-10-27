import http from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve,extname} from 'node:path';
import {randomUUID,timingSafeEqual,randomBytes,scryptSync,createHash} from 'node:crypto';
import YAML from 'yaml';
import QRCode from 'qrcode';

const root=resolve(process.cwd()),webDir=join(root,'apps/web'),dataDir=process.env.DATA_DIR||'/data';
await mkdir(dataDir,{recursive:true});
const settingsPath=join(dataDir,'config.yaml'),statePath=join(dataDir,'state.json');
const defaultConfig=YAML.parse(await readFile(join(root,'config/default.yaml'),'utf8'));
let settings=existsSync(settingsPath)?YAML.parse(await readFile(settingsPath,'utf8')):defaultConfig;
if(!existsSync(settingsPath)) await writeFile(settingsPath,YAML.stringify(settings));
const wordList=(await readFile(join(root,'config/profanity-words.txt'),'utf8')).split(/\r?\n/).map(x=>x.trim().toLowerCase()).filter(x=>x&&!x.startsWith('#'));
let state={queue:[],flagged:[],nowPlaying:null,messages:[],session:randomUUID().slice(0,8)};
if(existsSync(statePath)){try{state={...state,...JSON.parse(await readFile(statePath,'utf8'))};}catch{}}
state.playlists ||= [];
state.playlistTurn ||= 0;
state.selectedPlaylistId ||= null;
const playlistIdFromUrl=value=>{try{const u=new URL(value);if(!['youtube.com','www.youtube.com','music.youtube.com','m.youtube.com'].includes(u.hostname.toLowerCase()))return null;const id=u.searchParams.get('list');return id&&/^[A-Za-z0-9_-]{10,80}$/.test(id)?id:null;}catch{return null}};
const youtubeApi=async(path,params)=>{const key=process.env.YOUTUBE_API_KEY;if(!key)throw Error('YOUTUBE_API_KEY is required');const u=new URL('https://www.googleapis.com/youtube/v3/'+path);u.search=new URLSearchParams({...params,key}).toString();const response=await fetch(u,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('YouTube API '+response.status);return response.json()};
const playlistTracks=async id=>{const tracks=[];let pageToken='';do{const data=await youtubeApi('playlistItems',{part:'snippet,contentDetails',playlistId:id,maxResults:'50',...(pageToken?{pageToken}:{})});for(const item of data.items||[]){const videoId=item.contentDetails?.videoId||item.snippet?.resourceId?.videoId;if(videoId&&/^[A-Za-z0-9_-]{11}$/.test(videoId)&&item.snippet?.title!=='Deleted video'&&item.snippet?.title!=='Private video')tracks.push({videoId,title:item.snippet?.title||videoId})}pageToken=data.nextPageToken||'';}while(pageToken&&tracks.length<500);return tracks};
const channelHandleFromUrl=value=>{try{const u=new URL(value);if(!['youtube.com','www.youtube.com','m.youtube.com'].includes(u.hostname.toLowerCase()))return null;const m=u.pathname.match(/^\/@([A-Za-z0-9._-]+)(?:\/videos)?\/?$/);return m?m[1]:null;}catch{return null}};
const channelSource=async handle=>{const info=await youtubeApi('channels',{part:'snippet,contentDetails',forHandle:'@'+handle});const item=info.items?.[0];if(!item)throw Error('Channel not found or not publicly accessible');const uploads=item.contentDetails?.relatedPlaylists?.uploads;if(!uploads)throw Error('Channel uploads playlist unavailable');return {id:'channel:'+item.id,name:item.snippet?.title||handle,uploads,handle}};
const nextBackground=()=>{const active=state.playlists.filter(p=>p.enabled&&p.tracks?.length);if(!active.length)return null;const chosen=active.find(p=>p.id===state.selectedPlaylistId)||active[state.playlistTurn%active.length];if(!state.selectedPlaylistId)state.playlistTurn=(state.playlistTurn+1)%active.length;const index=(chosen.position||0)%chosen.tracks.length;const track=chosen.tracks[index];chosen.position=(index+1)%chosen.tracks.length;return {id:randomUUID(),videoId:track.videoId,title:track.title,nickname:'Playlist: '+chosen.name,source:'playlist',playlistId:chosen.id};};
const nextSong=()=>state.queue.shift()||nextBackground();
const save=()=>writeFile(statePath,JSON.stringify(state,null,2));
const send=(res,status,data,type='application/json; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(type.startsWith('application/json')?JSON.stringify(data):data);};
const body=async req=>{let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>20000)throw Error('Body too large');}return JSON.parse(raw||'{}');};
const token=process.env.ADMIN_TOKEN||'';
const authPath=join(dataDir,'admin-auth.json');
let credential=existsSync(authPath)?JSON.parse(await readFile(authPath,'utf8')):null;
const sessions=new Map();
const secureEq=(a,b)=>{const x=createHash('sha256').update(String(a)).digest(),z=createHash('sha256').update(String(b)).digest();return timingSafeEqual(x,z)};
const checkPassword=p=>credential?secureEq(scryptSync(String(p),Buffer.from(credential.salt,'hex'),64).toString('hex'),credential.hash):secureEq(p,process.env.ADMIN_PASSWORD||token);
const authorized=req=>{
 const sid=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('jukebox_session='))?.slice(16);
 if(sid&&sessions.get(sid)>Date.now())return true;
 const supplied=String(req.headers.authorization||'').replace(/^Bearer /,'');
 return !credential&&!!token&&secureEq(supplied,token);
};
const setPassword=async p=>{
 const salt=randomBytes(16).toString('hex');
 credential={salt,hash:scryptSync(p,Buffer.from(salt,'hex'),64).toString('hex')};
 await writeFile(authPath,JSON.stringify(credential),{mode:0o600});
 sessions.clear();
};
const loginAttempts=new Map();
const issueSession=res=>{
 const sid=randomBytes(32).toString('hex');
 sessions.set(sid,Date.now()+7*86400000);
 res.setHeader('Set-Cookie','jukebox_session='+sid+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800');
};

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
// Conservative metadata screening: hold suspicious requests for human review.
const adultContentReasons=snippet=>{
  const title=String(snippet?.title||'');
  const description=String(snippet?.description||'').slice(0,4000);
  const text=(title+' '+description).toLowerCase();
  const reasons=[];
  if(/\b(?:x[\s-]?rated|xxx|porn(?:ography|ographic)?|adult\s+(?:film|movie|video|entertainment)|sexually\s+explicit|erotic|onlyfans|nsfw)\b/i.test(text))reasons.push('Potential adult-themed content');
  if(/\b(?:official\s+trailer|movie\s+trailer|documentary\s+trailer|film\s+trailer)\b/i.test(title))reasons.push('Trailer rather than music');
  return reasons;
};
// YouTube does not provide a reliable music/non-music classification.
// These rules identify clear non-music signals; ambiguous videos are held for review.
const nonMusicAssessment=snippet=>{
  const title=String(snippet?.title||'');
  const description=String(snippet?.description||'').slice(0,2500);
  const category=String(snippet?.categoryId||'');
  const channel=String(snippet?.channelTitle||'');
  const combined=title+' '+description;
  if(/\b(?:official\s+(?:music\s+)?video|lyrics?\s+video|official\s+audio|visualizer|music\s+video|song\s+cover|full\s+album)\b/i.test(title)||category==='10')return {kind:'music'};
  if(/\b(?:movie\s+trailer|film\s+trailer|official\s+trailer|documentary|movie\s+review|gameplay|walkthrough|podcast|interview|news\s+report|tutorial|how\s+to|reaction\s+video|unboxing|stand[ -]?up\s+comedy)\b/i.test(title))return {kind:'non_music',reason:'Likely non-music video'};
  if(/\b(?:music|song|singer|band|artist|album|records|vevo|topic)\b/i.test(title+' '+channel))return {kind:'music'};
  return {kind:'unknown',reason:'Music content could not be verified'};
};
const videoInfo=async id=>{
  const key=process.env.YOUTUBE_API_KEY||'';
  if(!key)return null;
  const u=new URL('https://www.googleapis.com/youtube/v3/videos');
  u.search=new URLSearchParams({part:'snippet,contentDetails,status',id,key}).toString();
  const r=await fetch(u,{signal:AbortSignal.timeout(9000)});
  if(!r.ok)throw Error('YouTube metadata lookup failed: '+r.status);
  return (await r.json()).items?.[0]||null;
};
const candidateSearch=async (videoId)=>{
  const key=process.env.YOUTUBE_API_KEY||'';
  if(!key)return {candidates:[],reason:'Set YOUTUBE_API_KEY to enable alternative searches'};
  const original=await videoInfo(videoId);
  if(!original)return {candidates:[],reason:'Original video metadata unavailable'};
  const title=original.snippet?.title||'';
  const artist=original.snippet?.channelTitle||'';
  const base=title.replace(/\\([^)]*(official|video|lyrics?|audio|hd|4k)[^)]*\\)/gi,'').replace(/\\[[^\\]]*(official|video|lyrics?|audio)[^\\]]*\\]/gi,'').trim();
  const searches=[
    {type:'music_video',query:base+' official music video'},
    {type:'lyric_video',query:base+' official lyric video'},
    {type:'audio',query:base+' official audio'}
  ];
  const seen=new Set([videoId]),candidates=[];
  const limit=Math.max(1,Math.min(12,Number(settings.playback?.max_alternative_attempts||6)));
  for(const group of searches){
    const u=new URL('https://www.googleapis.com/youtube/v3/search');
    u.search=new URLSearchParams({part:'snippet',type:'video',videoEmbeddable:'true',maxResults:'8',q:group.query,key}).toString();
    const r=await fetch(u,{signal:AbortSignal.timeout(9000)});
    if(!r.ok)continue;
    const results=(await r.json()).items||[];
    const ids=results.map(x=>x.id?.videoId).filter(Boolean);
    if(!ids.length)continue;
    const v=new URL('https://www.googleapis.com/youtube/v3/videos');
    v.search=new URLSearchParams({part:'status,snippet',id:ids.join(','),key}).toString();
    const vr=await fetch(v,{signal:AbortSignal.timeout(9000)});
    if(!vr.ok)continue;
    const details=(await vr.json()).items||[];
    for(const item of details){
      if(seen.has(item.id)||item.status?.embeddable!==true||item.status?.privacyStatus!=='public')continue;
      const t=(item.snippet?.title||'').toLowerCase();
      const words=base.toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\\s+/).filter(w=>w.length>2);
      if(words.length&&words.filter(w=>t.includes(w)).length<Math.max(1,Math.ceil(words.length*.65)))continue;
      if(group.type==='music_video'&&/\\b(cover|reaction|karaoke|live|remix|lyrics?|audio only)\\b/i.test(t))continue;
      if(group.type==='lyric_video'&&!/lyric/i.test(t))continue;
      if(group.type==='audio'&&!/audio|topic|provided to youtube/i.test(t+' '+(item.snippet?.channelTitle||'')))continue;
      seen.add(item.id);
      candidates.push({videoId:item.id,title:item.snippet.title,channel:item.snippet.channelTitle,type:group.type});
      if(candidates.length>=limit)break;
    }
    if(candidates.length>=limit)break;
  }
  return {original:{title,artist},candidates};
};
const publicSettings=()=>({youtube:settings.youtube,requests:settings.requests,chat:{enabled:settings.chat.enabled,mode:settings.chat.mode,max_length:settings.chat.max_length},player:settings.player,playback:settings.playback||{}});
const publicState=()=>({queue:state.queue,nowPlaying:state.nowPlaying,messages:state.messages,session:state.session,playlists:state.playlists.map(({tracks,...p})=>({...p,trackCount:tracks.length})),selectedPlaylistId:state.selectedPlaylistId,settings:publicSettings()});
const lastPost=new Map();
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost'),path=url.pathname;
    if(req.method==='POST'&&path==='/api/admin/login'){
      const ip=req.socket.remoteAddress||'unknown',entry=loginAttempts.get(ip)||{count:0,until:0};
      if(entry.until>Date.now())return send(res,429,{error:'Too many attempts; retry later'});
      const b=await body(req);
      if(!checkPassword(String(b.password||''))){entry.count++;if(entry.count>=5){entry.until=Date.now()+300000;entry.count=0;}loginAttempts.set(ip,entry);return send(res,401,{error:'Incorrect password'});}
      loginAttempts.delete(ip);issueSession(res);return send(res,200,{ok:true,needsPasswordSetup:!credential});
    }
    if(req.method==='POST'&&path==='/api/admin/password'){
      if(!authorized(req))return send(res,401,{error:'Sign in first'});
      const b=await body(req),p=String(b.password||'');
      if(p.length<8||p.length>128)return send(res,400,{error:'Password must be 8–128 characters'});
      await setPassword(p);issueSession(res);return send(res,200,{ok:true});
    }
    if(req.method==='POST'&&path==='/api/admin/playlists'){
      if(!authorized(req))return send(res,401,{error:'Sign in first'});
      const b=await body(req),urlValue=String(b.url||''),id=playlistIdFromUrl(urlValue),handle=channelHandleFromUrl(urlValue);
      if(!id&&!handle)return send(res,400,{error:'Enter a YouTube playlist URL or a channel @handle/videos URL'});
      let entry;
      if(handle){
        const channel=await channelSource(handle);
        if(state.playlists.some(p=>p.id===channel.id))return send(res,409,{error:'Channel already added'});
        const tracks=await playlistTracks(channel.uploads);
        if(!tracks.length)return send(res,422,{error:'Channel has no accessible public uploads'});
        entry={id:channel.id,name:channel.name,url:'https://www.youtube.com/@'+channel.handle+'/videos',sourceType:'channel',uploadsId:channel.uploads,enabled:true,position:0,tracks,lastRefreshed:new Date().toISOString()};
      }else{
        if(state.playlists.some(p=>p.id===id))return send(res,409,{error:'Playlist already added'});
        const info=await youtubeApi('playlists',{part:'snippet',id});
        const item=info.items?.[0];if(!item)return send(res,404,{error:'Playlist not found or not accessible with API key'});
        const tracks=await playlistTracks(id);if(!tracks.length)return send(res,422,{error:'Playlist has no accessible tracks'});
        entry={id,name:item.snippet?.title||id,url:'https://www.youtube.com/playlist?list='+id,sourceType:'playlist',enabled:true,position:0,tracks,lastRefreshed:new Date().toISOString()};
      }
      state.playlists.push(entry);
      if(!state.selectedPlaylistId)state.selectedPlaylistId=entry.id;
      if(!state.nowPlaying)state.nowPlaying=nextSong();
      await save();return send(res,201,publicState());
    }
    if(req.method==='POST'&&path==='/api/admin/playlists/refresh'){
      if(!authorized(req))return send(res,401,{error:'Sign in first'});
      const b=await body(req),p=state.playlists.find(x=>x.id===b.id);
      if(!p)return send(res,404,{error:'Source not found'});
      const tracks=await playlistTracks(p.uploadsId||p.id);
      if(!tracks.length)return send(res,422,{error:'No accessible videos returned; existing catalog preserved'});
      const nextId=p.tracks?.[p.position%p.tracks.length]?.videoId;
      p.tracks=tracks;
      const index=tracks.findIndex(t=>t.videoId===nextId);
      p.position=index>=0?index:Math.min(p.position||0,tracks.length-1);
      p.lastRefreshed=new Date().toISOString();
      await save();return send(res,200,publicState());
    }
    if(req.method==='POST'&&path==='/api/admin/playlists/select'){
      if(!authorized(req))return send(res,401,{error:'Sign in first'});
      const b=await body(req),p=state.playlists.find(x=>x.id===b.id);
      if(!p)return send(res,404,{error:'Playlist not found'});
      p.enabled=true;
      state.selectedPlaylistId=p.id;
      await save();return send(res,200,publicState());
    }
    if(req.method==='PATCH'&&path==='/api/admin/playlists'){
      if(!authorized(req))return send(res,401,{error:'Sign in first'});
      const b=await body(req),p=state.playlists.find(x=>x.id===b.id);if(!p)return send(res,404,{error:'Playlist not found'});
      if(typeof b.enabled!=='boolean')return send(res,400,{error:'enabled must be boolean'});
      p.enabled=b.enabled;if(!p.enabled&&state.selectedPlaylistId===p.id)state.selectedPlaylistId=null;if(!state.nowPlaying)state.nowPlaying=nextSong();await save();return send(res,200,publicState());
    }
    if(req.method==='DELETE'&&path==='/api/admin/playlists'){
      if(!authorized(req))return send(res,401,{error:'Sign in first'});
      const b=await body(req);state.playlists=state.playlists.filter(p=>p.id!==b.id);if(state.selectedPlaylistId===b.id)state.selectedPlaylistId=null;await save();return send(res,200,publicState());
    }
    if(req.method==='GET'&&path==='/api/admin/flagged'){
      if(!authorized(req))return send(res,401,{error:'Sign in first'});
      return send(res,200,{items:state.flagged||[]});
    }
    if(req.method==='POST'&&path==='/api/admin/moderate'){
      if(!authorized(req))return send(res,401,{error:'Sign in first'});
      const b=await body(req),idx=(state.flagged||[]).findIndex(x=>x.id===b.id);
      if(idx<0)return send(res,404,{error:'Flagged request not found'});
      const [item]=state.flagged.splice(idx,1);
      if(b.action==='approve'){item.status='approved';state.queue.push(item);if(!state.nowPlaying)state.nowPlaying=nextSong();}
      else if(b.action!=='reject')return send(res,400,{error:'Invalid action'});
      await save();return send(res,200,{ok:true});
    }
    if(req.method==='GET'&&path==='/api/state'){if(!state.nowPlaying&&state.playlists.some(p=>p.enabled&&p.tracks?.length)){state.nowPlaying=nextSong();await save();}return send(res,200,publicState());}
    if(req.method==='GET'&&path==='/api/alternatives'){
      const id=url.searchParams.get('videoId')||'';
      if(!/^[A-Za-z0-9_-]{11}$/.test(id))return send(res,400,{error:'Invalid video ID'});
      if(!settings.playback?.auto_find_alternative)return send(res,200,{candidates:[],reason:'Automatic fallback disabled'});
      try{return send(res,200,await candidateSearch(id));}
      catch(e){console.error(e);return send(res,503,{error:'Alternative search unavailable'});}
    }
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
      if([...state.queue,...(state.flagged||[])].some(x=>x.videoId===id)||state.nowPlaying?.videoId===id)return send(res,409,{error:'Already queued or playing'});
      if(state.queue.filter(x=>x.nickname.toLowerCase()===nickname.toLowerCase()).length>=settings.requests.max_pending_per_guest)return send(res,429,{error:'Request limit reached'});
      let metadata=null;
      try{metadata=await videoInfo(id);}catch(e){console.warn('Metadata unavailable:',e.message);}
      if(metadata&&metadata.status?.privacyStatus!=='public')return send(res,422,{error:'Video is not public'});
      const reasons=[];
      if(!metadata)reasons.push('Metadata could not be verified');
      if(metadata)reasons.push(...adultContentReasons(metadata.snippet));
      const nonMusicFilter=settings.filters?.non_music;
      if(nonMusicFilter?.enabled){
        const assessment=metadata?nonMusicAssessment(metadata.snippet):{kind:'unknown',reason:'Music content could not be verified'};
        if(assessment.kind!=='music'){
          if(nonMusicFilter.action==='reject')return send(res,422,{error:assessment.reason+' (non-music filter)'});
          reasons.push(assessment.reason);
        }
      }
      if(metadata?.contentDetails?.contentRating?.ytRating==='ytAgeRestricted')reasons.push('YouTube age-restricted content');
      if(metadata?.status?.embeddable===false)reasons.push('Embedding restricted');
      const duration=metadata?.contentDetails?.duration||'';
      const match=duration.match(/^PT(?:(\\d+)H)?(?:(\\d+)M)?(?:(\\d+)S)?$/);
      const seconds=match?Number(match[1]||0)*3600+Number(match[2]||0)*60+Number(match[3]||0):0;
      if(seconds&&seconds>Number(settings.requests.max_video_minutes||8)*60)reasons.push('Video exceeds duration limit');
      // YouTube metadata does not reliably identify explicit lyrics or genre.
      // Never label those filters as verified.
      const item={id:randomUUID(),videoId:id,nickname,url:'https://www.youtube.com/watch?v='+id,title:metadata?.snippet?.title||'YouTube video '+id,submittedAt:new Date().toISOString(),status:reasons.length?'flagged':'queued',flagReasons:reasons};
      if(reasons.length){state.flagged||=[];state.flagged.push(item);}else {state.queue.push(item);if(!state.nowPlaying)state.nowPlaying=nextSong();}
      await save();return send(res,201,{item,flagged:!!reasons.length,warning:reasons.length?reasons.join('; '):null});
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
      state.nowPlaying=nextSong();await save();return send(res,200,publicState());
    }
    if(path==='/api/admin/messages'&&req.method==='DELETE'){
      if(!authorized(req))return send(res,401,{error:'Admin token required'});
      state.messages=[];await save();return send(res,200,{ok:true});
    }
    if(req.method==='POST'&&path==='/api/player/advance'){
      const b=await body(req);
      if(!state.nowPlaying||state.nowPlaying.id!==b.currentId)return send(res,409,{error:'Playback changed'});
      state.nowPlaying=state.queue.shift()||null;await save();return send(res,200,publicState());
    }
    if(req.method!=='GET')return send(res,405,{error:'Method not allowed'});
    const file=path==='/app.js'?join(webDir,'app.js'):path==='/style.css'?join(webDir,'style.css'):join(webDir,'index.html');
    const content=await readFile(file);return send(res,200,content,mime[extname(file)]||'text/html; charset=utf-8');
  }catch(e){console.error(e);if(!res.headersSent)send(res,500,{error:'Server error'});}
}).listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('YT Music Jukebox started'));
