const app=document.querySelector('#app');
const el=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
const path=location.pathname;
async function state(){return (await fetch('/api/state',{cache:'no-store'})).json();}
async function render(){
  const s=await state();app.replaceChildren();
  if(path==='/join'){
    app.append(el('h2','Request a Song'),el('p','Paste a YouTube video link. Submissions are currently stored for testing only; playback and filtering are upcoming.'));
    const form=document.createElement('form');const name=document.createElement('input');name.placeholder='Nickname';name.maxLength=32;name.required=true;const url=document.createElement('input');url.placeholder='YouTube video URL';url.type='url';url.required=true;const btn=el('button','Submit request');const status=el('p','');form.append(name,url,btn,status);form.addEventListener('submit',async e=>{e.preventDefault();const r=await fetch('/api/requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nickname:name.value,url:url.value})});const body=await r.json();status.textContent=r.ok?'Request stored (pending metadata validation)':body.error;if(r.ok)url.value='';await renderQueue();});app.append(form);
  }else if(path==='/player'){
    app.append(el('h2','TV Player'),el('p','Player integration is the next milestone. This screen currently shows the saved queue.'));
    app.append(el('p','Guest requests: '+location.origin+'/join'));
  }else if(path==='/admin'){
    app.append(el('h2','Host Dashboard'),el('p','Host authentication and moderation are not implemented yet. This page is currently read-only.'));
  }else if(path==='/settings'){
    app.append(el('h2','Configuration'),el('p','Configuration editing, OAuth, filtering, and display preferences are planned.'));
  }else{app.append(el('h2','Welcome'),el('p','Your self-hosted party jukebox starts here. Open the player or request a song.'));}
  const section=document.createElement('section');section.id='queue';app.append(section);await renderQueue();
}
async function renderQueue(){const s=await state();const container=document.querySelector('#queue');if(!container)return;container.replaceChildren(el('h2','Queued Requests ('+s.queue.length+')'));const list=document.createElement('ol');for(const item of s.queue){list.append(el('li',item.videoId+' — requested by '+item.nickname+' ('+item.status+')'));}container.append(list);}
render();setInterval(renderQueue,3000);
