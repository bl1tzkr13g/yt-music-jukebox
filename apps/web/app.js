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
  form.onsubmit=async e=>{e.preventDefault();localStorage.setItem('jukeboxNickname',nick.value);try{await api('/api/requests',{method:'POST',body:JSON.stringify({nickname:nick.value,url:link.value})});say('Request saved for validation (playback not yet enabled).');link.value='';}catch(err){say(err.message)}};
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
  let lastVideo=null,lastQR='',playerInstance=null,attempted=new Set(),fallbacks=[],fallbackIndex=0,activeId=null,loadingFallback=false;
  function showVideo(id){
    activeId=id;
    video.replaceChildren();
    const holder=node('div');holder.id='yt-jukebox-player';holder.style.width='100%';holder.style.height='100%';video.append(holder);
    if(!window.YT?.Player){video.append(node('p','Loading YouTube player…'));return;}
    playerInstance=new YT.Player(holder,{width:'100%',height:'100%',videoId:id,playerVars:{autoplay:1,playsinline:1,origin:location.origin},events:{
      onReady:e=>{try{e.target.playVideo()}catch{}},
      onError:()=>tryFallback(),
      onStateChange:e=>{if(e.data===YT.PlayerState.ENDED)tryFallback(true)}
    }});
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
        video.replaceChildren(node('div','This video cannot be embedded; no playable alternative found. Ask the host to advance the queue.','placeholder'));
      }else{
        video.replaceChildren(node('div','Song finished. Waiting for the host to advance the queue.','placeholder'));
      }
    }catch(e){video.replaceChildren(node('div','Playback failed: '+e.message,'placeholder'))}
    finally{loadingFallback=false}
  }
  const ytScript=node('script');ytScript.src='https://www.youtube.com/iframe_api';document.head.append(ytScript);
  const previousReady=window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady=()=>{previousReady?.();if(lastVideo)showVideo(lastVideo)};
  async function refresh(){try{
    const s=await api('/api/state'),p=s.settings.player||{},c=s.settings.chat||{};
    app.style.setProperty('--bg',p.theme?.background||'#850019');app.style.setProperty('--panel',p.theme?.panel||'#fff');app.style.setProperty('--ink',p.theme?.text||'#151515');app.style.setProperty('--side',(p.sidebar_percent||28)+'%');
    playlist.textContent='Default Playlist: '+(s.settings.youtube?.default_playlist_name||'Not configured');
    title.textContent='Now Playing: '+(s.nowPlaying?.title||'Waiting for a song');
    requester.textContent='Requested by: '+(s.nowPlaying?.nickname||'Default playlist');
    if(s.nowPlaying?.videoId!==lastVideo){lastVideo=s.nowPlaying?.videoId||null;attempted=new Set();fallbacks=[];fallbackIndex=0;if(lastVideo){attempted.add(lastVideo);showVideo(lastVideo)}else video.replaceChildren(node('div','Waiting for playback…','placeholder'))}
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
function admin(){app.className='';const p=node('div',undefined,'panel');add(p,node('h1','Host Dashboard'),node('p','Admin actions require an ADMIN_TOKEN set in Docker.'));const token=node('input');token.type='password';token.placeholder='Admin token';token.value=auth();token.onchange=()=>sessionStorage.setItem('adminToken',token.value);p.append(token);const say=status(p);add(p,makeButton('Play next queued request',async()=>{try{await api('/api/admin/advance',{method:'POST',admin:true});say('Queue advanced')}catch(e){say(e.message)}}),makeButton('Clear chat',async()=>{try{await api('/api/admin/messages',{method:'DELETE',admin:true});say('Chat cleared')}catch(e){say(e.message)}}));app.append(p)}
function settings(){app.className='';const p=node('div',undefined,'panel');add(p,node('h1','Configuration'),node('p','Edit YAML settings. Changes save to /data/config.yaml and apply immediately. Keep a backup before editing.'));const token=node('input');token.type='password';token.placeholder='Admin token';token.value=auth();token.onchange=()=>sessionStorage.setItem('adminToken',token.value);const editor=node('textarea');editor.spellcheck=false;const say=status(p);
  add(p,token,makeButton('Load configuration',async()=>{try{editor.value=(await api('/api/admin/config',{admin:true})).yaml;say('Loaded')}catch(e){say(e.message)}}),editor,makeButton('Save configuration',async()=>{try{await api('/api/admin/config',{method:'PUT',admin:true,body:JSON.stringify({yaml:editor.value})});say('Saved')}catch(e){say(e.message)}}));app.append(p)}
if(path==='/player')player();else if(path==='/join')guest();else if(path==='/admin')admin();else if(path==='/settings')settings();else{app.className='';const p=node('div',undefined,'panel');add(p,node('h1','YT Music Jukebox'),node('p','Open the TV player, submit a song request, or configure the host.'));app.append(p)}
