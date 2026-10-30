const app=document.querySelector('#app'),path=location.pathname;
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e};
const auth=()=>sessionStorage.getItem('adminToken')||'';
const api=async(url,opts={})=>{const r=await fetch(url,{...opts,headers:{'Content-Type':'application/json',...(opts.admin?{'Authorization':'Bearer '+auth()}:{})},cache:'no-store'});const data=await r.json();if(!r.ok)throw Error(data.error||'Request failed');return data};
const add=(parent,...children)=>parent.append(...children);
const makeButton=(label,handler)=>{const b=node('button',label);b.onclick=handler;return b};
const status=(parent)=>{const p=node('p','', 'status');parent.append(p);return msg=>p.textContent=msg};
function requestForm(parent){
  const form=node('form');const nick=node('input');nick.placeholder='Your nickname';nick.maxLength=32;nick.required=true;nick.value=localStorage.getItem('jukeboxNickname')||'';
  const link=node('input');link.type='url';link.placeholder='Paste a YouTube video link';link.required=true;
  const submit=node('button','Add to Queue');submit.type='submit';const say=status(form);add(form,nick,link,submit);
  form.onsubmit=async e=>{e.preventDefault();localStorage.setItem('jukeboxNickname',nick.value);try{await api('/api/requests',{method:'POST',body:JSON.stringify({nickname:nick.value,url:link.value})});say('Request submitted. Songs needing review are held for the host.');link.value='';}catch(err){say(err.message)}};
  parent.append(form);
}
function chatForm(parent){
  const form=node('form',undefined,'chat-form');const nick=node('input');nick.placeholder='Nickname';nick.maxLength=32;nick.value=localStorage.getItem('jukeboxNickname')||'';
  const msg=node('input');msg.placeholder='Your message';msg.maxLength=240;const mode=node('select');
  for(const [value,label] of [['live','Live Chat'],['song','Current Song']]){const o=node('option',label);o.value=value;mode.append(o)}
  const submit=node('button','Send');submit.type='submit';const say=status(form);add(form,nick,mode,msg,submit);
  form.onsubmit=async e=>{e.preventDefault();localStorage.setItem('jukeboxNickname',nick.value);try{await api('/api/messages',{method:'POST',body:JSON.stringify({nickname:nick.value,message:msg.value,mode:mode.value})});msg.value='';say('Message sent');}catch(err){say(err.message)}};
  parent.append(form);
}
function renderQueue(container,s){container.replaceChildren();if(!s.queue.length){container.append(node('p','No guest requests yet.'));return;}for(const item of s.queue){const row=node('div',undefined,'queue-entry');add(row,node('strong',item.title||item.videoId),node('small','Requested by '+item.nickname));container.append(row)}}
function player(){
  app.className='player';const layout=node('div',undefined,'layout'),left=node('div',undefined,'left'),right=node('aside',undefined,'sidebar');
  const video=node('div',undefined,'video'),placeholder=node('div','Waiting for playback…','placeholder');video.append(placeholder);
  const now=node('div',undefined,'now'),title=node('h2','Now Playing: Waiting for a song'),requester=node('p','Default playlist');add(now,title,requester);
  const comments=node('section',undefined,'comments'),commentTitle=node('h3','Comments'),messages=node('div');add(comments,commentTitle,messages);
  const playlist=node('strong','Default Playlist'),upnext=node('div'),queueTitle=node('h3','Queue'),queue=node('div',undefined,'queue'),qr=node('div',undefined,'qr');
  const qrTitle=node('strong','Scan to request music'),qrImg=node('img'),qrLink=node('small');qrImg.alt='Guest request QR code';add(qr,qrTitle,qrImg,qrLink);
  add(left,video,now,comments);add(right,playlist,upnext,queueTitle,queue,qr);add(layout,left,right);app.append(layout);
  let currentItemId=null,lastVideo=null,lastQR='',playerInstance=null,attempted=new Set(),fallbacks=[],fallbackIndex=0,activeId=null,loadingFallback=false,playbackTimer=null,playing=false;
  const tvMode=new URLSearchParams(location.search).get('display')==='tv';
  function playbackNotice(message){let n=video.querySelector('.playback-notice');if(!n){n=node('button',undefined,'playback-notice');n.style.cssText='position:absolute;bottom:14px;left:50%;transform:translateX(-50%);z-index:10;padding:12px 18px;background:#222;color:#fff;border:2px solid #fff;cursor:pointer';n.onclick=()=>window.fireTvStartPlayback();video.append(n)}n.textContent=message;}
  window.fireTvStartPlayback=()=>{try{playerInstance?.playVideo();}catch(e){console.warn('Playback start:',e)};};
  function showVideo(id){
    activeId=id;playing=false;if(playbackTimer)clearTimeout(playbackTimer);
    try{playerInstance?.destroy()}catch{}
    playerInstance=null;
    video.replaceChildren();
    const holder=node('div');holder.id='yt-jukebox-player';holder.style.width='100%';holder.style.height='100%';video.append(holder);
    if(!window.YT?.Player){video.append(node('p','Loading YouTube player…'));return;}
    if(tvMode)playbackTimer=setTimeout(()=>{if(!playing&&activeId===id)playbackNotice('Press OK to start video');},10000);
    playerInstance=new YT.Player(holder,{width:'100%',height:'100%',videoId:id,playerVars:{autoplay:1,playsinline:1,origin:location.origin},events:{
      onReady:e=>{try{e.target.playVideo()}catch{}},
      onError:()=>tryFallback(),
      onStateChange:e=>{if(e.data===YT.PlayerState.PLAYING){playing=true;if(playbackTimer)clearTimeout(playbackTimer);video.querySelector('.playback-notice')?.remove()}if(e.data===YT.PlayerState.ENDED)tryFallback(true)}
    }});
  }
  async function advanceAutomatically(){
    if(!currentItemId)return;
    try{await api('/api/player/advance',{method:'POST',body:JSON.stringify({currentId:currentItemId})});}catch(e){console.warn(e)}
  }
  async function tryFallback(ended=false){
    if(loadingFallback)return;
    loadingFallback=true;
    try{
      if(!fallbacks.length&&!ended){
        const data=await api('/api/alternatives?videoId='+encodeURIComponent(lastVideo));
        fallbacks=data.candidates||[];
        fallbackIndex=0;
      }
      if(!ended){
        while(fallbackIndex<fallbacks.length&&attempted.has(fallbacks[fallbackIndex].videoId))fallbackIndex++;
        const next=fallbacks[fallbackIndex++];
        if(next){attempted.add(next.videoId);title.textContent='Fallback: '+next.title;showVideo(next.videoId);return;}
        video.replaceChildren(node('div','This video cannot be embedded; no playable alternative found. Skipping request…','placeholder'));if(currentItemId)await advanceAutomatically();return;
      }else{
        video.replaceChildren(node('div','Song finished. Loading next request…','placeholder'));await advanceAutomatically();
      }
    }catch(e){video.replaceChildren(node('div','Playback failed: '+e.message,'placeholder'))}
    finally{loadingFallback=false}
  }
  const ytScript=node('script');ytScript.src='https://www.youtube.com/iframe_api';document.head.append(ytScript);
  const previousReady=window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady=()=>{previousReady?.();if(lastVideo)showVideo(lastVideo)};
  if(window.YT?.Player&&lastVideo)showVideo(lastVideo);
  async function refresh(){try{
    const s=await api('/api/state'),p=s.settings.player||{},c=s.settings.chat||{};
    app.style.setProperty('--bg',p.theme?.background||'#850019');app.style.setProperty('--panel',p.theme?.panel||'#fff');app.style.setProperty('--ink',p.theme?.text||'#151515');app.style.setProperty('--side',(p.sidebar_percent||28)+'%');
    playlist.textContent='Enabled playlists: '+(s.playlists?.filter(p=>p.enabled).map(p=>p.name).join(', ')||'None configured');
    title.textContent='Now Playing: '+(s.nowPlaying?.title||'Waiting for a song');
    requester.textContent='Requested by: '+(s.nowPlaying?.nickname||'Default playlist');
    if(s.nowPlaying?.videoId!==lastVideo){currentItemId=s.nowPlaying?.id||null;lastVideo=s.nowPlaying?.videoId||null;attempted=new Set();fallbacks=[];fallbackIndex=0;if(lastVideo){attempted.add(lastVideo);showVideo(lastVideo)}else video.replaceChildren(node('div','Waiting for playback…','placeholder'))}
    upnext.replaceChildren(node('h2','Up Next'),node('strong',s.queue[0]?.title||'Default playlist'),node('p','Requested by: '+(s.queue[0]?.nickname||'Host')));
    queueTitle.style.display=p.show_queue===false?'none':'';queue.style.display=p.show_queue===false?'none':'';
    if(p.show_queue!==false)renderQueue(queue,{queue:s.queue.slice(1)});
    comments.style.display=p.show_comments===false||!c.enabled?'none':'';
    messages.replaceChildren();for(const m of s.messages.filter(x=>c.mode==='both'||x.mode===c.mode).filter(x=>x.mode==='live'||x.videoId===s.nowPlaying?.videoId).slice(-20)){messages.append(node('div',m.nickname+': '+m.message,'message'))}
    qr.style.display=p.show_qr_code===false?'none':'';
    const join=location.origin+'/join';if(lastQR!==join){lastQR=join;qrImg.src='/api/qr?base='+encodeURIComponent(join);qrLink.textContent=join}
  }catch(e){console.error(e)}}
  refresh();setInterval(refresh,3000);
}
function guest(){app.className='';const p=node('div',undefined,'panel');add(p,node('h1','Request Music'),node('p','Join the queue by pasting a YouTube video link.'));requestForm(p);add(p,node('h2','Chat and Song Comments'));chatForm(p);const queue=node('div');p.append(queue);app.append(p);const refresh=async()=>{try{const s=await api('/api/state');queue.replaceChildren(node('h2','Upcoming Requests'));renderQueue(queue,s)}catch{}};refresh();setInterval(refresh,3000)}
function loginPanel(p){
 const pw=node('input');pw.type='password';pw.placeholder='Admin password (or original token for first login)';
 const say=status(p);
 add(p,node('h2','Host sign in'),pw,makeButton('Sign in',async()=>{try{await api('/api/admin/login',{method:'POST',body:JSON.stringify({password:pw.value})});pw.value='';say('Signed in. You can now manage the jukebox.');}catch(e){say(e.message)}}));
 const newPw=node('input');newPw.type='password';newPw.placeholder='Set or change password (8+ characters)';
 add(p,newPw,makeButton('Save new password',async()=>{try{await api('/api/admin/password',{method:'POST',body:JSON.stringify({password:newPw.value})});newPw.value='';say('Password saved. You remain signed in.')}catch(e){say(e.message)}}));
}
function admin(){
 app.className='';const p=node('div',undefined,'panel');add(p,node('h1','Host Dashboard'),node('p','Sign in once; your browser remembers the session for seven days.'));loginPanel(p);
 const say=status(p),flagged=node('div'),playlists=node('div'),playlistUrl=node('input');playlistUrl.type='url';playlistUrl.placeholder='Paste YouTube playlist or channel /videos URL';playlistUrl.style.width='100%';
 add(p,node('h2','Background playlists'),playlistUrl,makeButton('Add playlist',async()=>{try{await api('/api/admin/playlists',{method:'POST',admin:true,body:JSON.stringify({url:playlistUrl.value})});playlistUrl.value='';await loadPlaylists();say('Playlist added')}catch(e){say(e.message)}}),makeButton('Refresh playlists',loadPlaylists),playlists);
 async function loadPlaylists(){try{const d=await api('/api/state');playlists.replaceChildren();for(const item of d.playlists||[]){const row=node('div',undefined,'queue-entry');const toggle=node('input');toggle.type='checkbox';toggle.checked=item.enabled;toggle.onchange=async()=>{try{await api('/api/admin/playlists',{method:'PATCH',admin:true,body:JSON.stringify({id:item.id,enabled:toggle.checked})});await loadPlaylists()}catch(e){say(e.message)}};add(row,toggle,node('strong',item.name),makeButton(d.selectedPlaylistId===item.id?'Selected for next song':'Select playlist',async()=>{try{await api('/api/admin/playlists/select',{method:'POST',admin:true,body:JSON.stringify({id:item.id})});await loadPlaylists();say('Playlist selected. Current song will finish first.')}catch(e){say(e.message)}}),node('small',(item.sourceType==='channel'?'Channel · ':'Playlist · ')+item.trackCount+' videos · next '+(item.position+1)),makeButton('Refresh videos',async()=>{try{await api('/api/admin/playlists/refresh',{method:'POST',admin:true,body:JSON.stringify({id:item.id})});await loadPlaylists();say('Videos refreshed')}catch(e){say(e.message)}}),makeButton('Remove',async()=>{try{await api('/api/admin/playlists',{method:'DELETE',admin:true,body:JSON.stringify({id:item.id})});await loadPlaylists()}catch(e){say(e.message)}}));playlists.append(row)}if(!d.playlists?.length)playlists.append(node('p','No playlists added yet.'))}catch(e){say(e.message)}}
 add(p,makeButton('Play next queued request',async()=>{try{await api('/api/admin/advance',{method:'POST',admin:true});say('Queue advanced')}catch(e){say(e.message)}}),makeButton('Clear chat',async()=>{try{await api('/api/admin/messages',{method:'DELETE',admin:true});say('Chat cleared')}catch(e){say(e.message)}}),node('h2','Flagged requests'),makeButton('Refresh flagged requests',loadFlagged),flagged);
 async function loadFlagged(){try{const d=await api('/api/admin/flagged',{admin:true});flagged.replaceChildren();if(!d.items.length)flagged.append(node('p','No requests awaiting review'));for(const item of d.items){const row=node('div',undefined,'queue-entry');add(row,node('strong',item.title),node('p',item.flagReasons.join('; ')),makeButton('Approve',()=>moderate(item.id,'approve')),makeButton('Reject',()=>moderate(item.id,'reject')));flagged.append(row)}}catch(e){say(e.message)}}
 async function moderate(id,action){try{await api('/api/admin/moderate',{method:'POST',admin:true,body:JSON.stringify({id,action})});await loadFlagged()}catch(e){say(e.message)}}
 app.append(p);
 loadPlaylists();
 loadFlagged();
}
function settings(){
 app.className='';const p=node('div',undefined,'panel');add(p,node('h1','Configuration'),node('p','Edit YAML settings. Changes save to /data/config.yaml.'));loginPanel(p);
 const editor=node('textarea');editor.spellcheck=false;const say=status(p);
 add(p,makeButton('Load configuration',async()=>{try{editor.value=(await api('/api/admin/config',{admin:true})).yaml;say('Loaded')}catch(e){say(e.message)}}),editor,makeButton('Save configuration',async()=>{try{await api('/api/admin/config',{method:'PUT',admin:true,body:JSON.stringify({yaml:editor.value})});say('Saved')}catch(e){say(e.message)}}));app.append(p);
}
if(path==='/player')player();else if(path==='/join')guest();else if(path==='/admin')admin();else if(path==='/settings')settings();else{app.className='';const p=node('div',undefined,'panel');add(p,node('h1','YT Music Jukebox'),node('p','Open the TV player, submit a song request, or configure the host.'));app.append(p)}
