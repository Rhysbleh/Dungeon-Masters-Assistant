import { CompendiumAdapter, detectReferences, searchReferences } from './references.js';
import { consumeSSE, TranscriptState } from './stream.js';
import { resolveSidebarAdapter } from './foundry-adapter.js';

const ID='dm-copilot';let controller,versionAdapter;
class CopilotUI {
  constructor() {
    this.roots=new Set();this.state=new TranscriptState();this.references=[];this.query='';this.referenceQuery='';this.status='Disconnected';this.sessions=[];this.journal='';
    this.adapter=new CompendiumAdapter(game,foundry.utils.fromUuid);this.abort=null;this.timer=null;this.streamAbort=null;this.pairText='';this.indexStatus='Compendium names not loaded';
    this.key=`scribe:${game.world.id}:${game.user.id}`;
    this.pins=new Set(JSON.parse(sessionStorage.getItem(`${this.key}:pins`)??'[]'));
    this.dismissed=new Set();this.preferences=game.settings.get(ID,'references');
  }
  mount(root) {
    this.roots.add(root);root.querySelector('.cp-url').value=this.base??sessionStorage.getItem(`${this.key}:url`)??'http://127.0.0.1:47832';
    root.querySelector('.cp-preferred').value=(this.preferences.preferred??[]).join(', ');
    root.querySelector('.cp-excluded').value=(this.preferences.excluded??[]).join(', ');
    root.onclick=e=>{const button=e.target.closest('[data-cp]');if(button) void this.action(button.dataset.cp,root,button).catch(error=>{this.status=error.message;this.update();});};
    root.querySelector('.cp-search').oninput=e=>{this.query=e.target.value.toLowerCase();this.update();};
    let debounce;
    root.querySelector('.cp-reference-search').oninput=e=>{clearTimeout(debounce);debounce=setTimeout(()=>{this.referenceQuery=e.target.value;this.update();},200);};
    this.update();
  }
  async api(path,method='GET',body,signal=this.abort?.signal) {
    if(!this.token) throw new Error('Connect to the backend first');
    const response=await fetch(`${this.base}${path}`,{method,headers:{Authorization:`Bearer ${this.token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),credentials:'omit',redirect:'error'});
    const data=await response.json();if(!response.ok) throw Object.assign(new Error(data.error??`Backend HTTP ${response.status}`),{status:response.status});return data;
  }
  async connect(base,token) {
    this.disconnect(false);
    const url=new URL(base);
    if(url.username || url.password || url.search || url.hash || !(url.protocol==='https:' || url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw new Error('Use HTTPS, or HTTP on localhost only');
    if(!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Enter the private world credential issued by the server operator');
    this.base=base.replace(/\/$/,'');this.token=token;this.abort=new AbortController();
    try {
      await this.refreshStatus();
      sessionStorage.setItem(`${this.key}:url`,this.base);sessionStorage.setItem(`${this.key}:token`,token);
      this.timer=setInterval(()=>void this.refreshStatus().catch(e=>{this.status=e.message;if(e.status===401)this.disconnect();this.update();}),5000);
      void this.index();
    } catch(e) {this.disconnect();throw e;}
  }
  disconnect(forget=true) {
    this.abort?.abort();this.streamAbort?.abort();clearInterval(this.timer);this.abort=null;this.streamAbort=null;
    this.token=null;this.state.reset();this.references=[];this.sessions=[];this.journal='';this.status='Disconnected';this.pairText='';this.streamState='Disconnected';
    if(forget)sessionStorage.removeItem(`${this.key}:token`);
    this.update();
  }
  async refreshStatus() {
    const data=await this.api('/v1/status');
    if(data.identity.worldId!==game.world.id || data.identity.foundryUserId!==game.user.id) throw new Error('Credential does not belong to this Foundry world and GM');
    if(data.link?.id!==this.state.link?.id) {
      this.streamAbort?.abort();this.streamAbort=null;this.state.reset(data.link);this.references=[];this.journal='';this.dismissed.clear();
      if(data.link) {this.streamAbort=new AbortController();void this.stream(this.streamAbort);}
    }
    this.sessions=data.sessions;
    this.status=data.link?`${this.streamState??'Connecting stream'} · ${data.sessions[0]?.state??'no recording session'}`:'Connected · world not paired';
    const scene=game.scenes.active;
    if(data.link && scene && Date.now()-(this.sceneSent??0)>30000) {await this.api('/v1/scene','POST',{sceneId:scene.id});this.sceneSent=Date.now();}
    this.update();
  }
  async stream(abort) {
    let backoff=1000;
    while(!abort.signal.aborted && this.abort && !this.abort.signal.aborted) {
      try {
        const response=await fetch(`${this.base}/v1/stream?after=${this.state.cursor}`,{headers:{Authorization:`Bearer ${this.token}`},signal:abort.signal,credentials:'omit',redirect:'error'});
        if(response.ok){this.streamState='Live transcript connection';this.status=this.streamState;this.update();}
        await consumeSSE(response,async(type,event)=>{
          if(type==='unlinked') {abort.abort();void this.refreshStatus().catch(()=>{});return;}
          if(type==='transcript' && this.state.accept(event)) {
            backoff=1000;
            if(!this.state.paused) this.detect(event);
            this.scheduleUpdate();
          }
        },abort.signal);
        if(!abort.signal.aborted) throw new Error('Stream disconnected');
      } catch(e) {
        if(abort.signal.aborted) return;
        this.streamState=`Reconnecting transcript stream · ${e.message}`;this.status=this.streamState;this.update();
        if(e.status===401 || e.status===403) {this.disconnect();return;}
        await new Promise(resolve=>{const done=()=>{clearTimeout(t);abort.signal.removeEventListener('abort',done);resolve();};const t=setTimeout(done,backoff);abort.signal.addEventListener('abort',done,{once:true});});
        backoff=Math.min(15000,backoff*2);
      }
    }
  }
  detect(event) {
    const matches=detectReferences(this.adapter.accessibleEntries(),event.text,this.preferences);
    for(const match of matches) {
      const key=`${event.eventId}:${match.uuid}`;
      if(!this.references.some(r=>r.key===key))this.references.push({...match,key,eventId:event.eventId,sessionId:event.sessionId,timestamp:event.timestamp,speaker:event.displayName});
    }
    this.references=this.references.slice(-100);
  }
  async index() {
    this.indexStatus='Loading accessible compendium names…';this.update();
    const result=await this.adapter.index(this.preferences.excluded);
    this.indexStatus=`${result.entries.length} names indexed${result.failures.length?`; unavailable or capped: ${result.failures.join(', ')}`:''}`;
    for(const row of this.state.rows.slice(-100))this.detect(row);
    this.update();
  }
  scheduleUpdate(){if(!this.updateTimer)this.updateTimer=setTimeout(()=>{this.updateTimer=null;this.update();},100);}
  async action(action,root,button) {
    if(!game.user.isGM) throw new Error('GM access required');
    if(action==='connect') {await this.connect(root.querySelector('.cp-url').value.trim(),root.querySelector('.cp-token').value.trim());root.querySelector('.cp-token').value='';}
    if(action==='disconnect')this.disconnect();
    if(action==='pair') {const result=await this.api('/v1/pairings','POST');this.pairText=`In Discord: /scribe pair code:${result.code} channel:<voice channel>. Expires ${new Date(result.expires).toLocaleTimeString()}. Single use.`;}
    if(action==='unlink') {await this.api('/v1/link','DELETE');await this.refreshStatus();this.pairText='Association removed. Stop the old Discord session before relinking.';}
    if(action==='pause') {
      if(this.state.paused){const pending=[...this.state.pending];this.state.resume();for(const e of pending)this.detect(e);}else this.state.paused=true;
    }
    if(action==='index') await this.index();
    if(action==='preferences') {
      this.preferences={...this.preferences,preferred:root.querySelector('.cp-preferred').value.split(',').map(s=>s.trim()).filter(Boolean),excluded:root.querySelector('.cp-excluded').value.split(',').map(s=>s.trim()).filter(Boolean)};
      await game.settings.set(ID,'references',this.preferences);this.references=[];await this.index();
    }
    if(action==='open') await this.adapter.open(button.dataset.uuid);
    if(action==='pin') {if(this.pins.has(button.dataset.uuid))this.pins.delete(button.dataset.uuid);else this.pins.add(button.dataset.uuid);sessionStorage.setItem(`${this.key}:pins`,JSON.stringify([...this.pins]));}
    if(action==='dismiss')this.dismissed.add(button.dataset.key);
    if(action==='summary' || action==='summaries') {
      const session=root.querySelector('.cp-session').value;if(!session)throw new Error('No linked session yet');
      if(action==='summary'){const result=await this.api('/v1/summary','POST',{sessionId:session});this.journal=`Journal request: ${result.state}. Refresh after generation. AI interpretations require DM review.`;}
      else {const result=await this.api(`/v1/summaries?sessionId=${encodeURIComponent(session)}`);this.journal=result.summaries.map(n=>`${new Date(n.at).toLocaleString()}\n${n.body.items.map(i=>`${i.category}: ${i.text}\nEvidence: ${i.evidence.join(', ')}`).join('\n\n')}`).join('\n\n')||'No journal yet.';}
    }
    this.update();
  }
  update() {
    for(const root of this.roots) {
      if(!root.isConnected){this.roots.delete(root);continue;}
      if(!game.user.isGM){
        root.replaceChildren();this.roots.delete(root);this.abort?.abort();this.streamAbort?.abort();clearInterval(this.timer);
        sessionStorage.removeItem(`${this.key}:token`);this.token=null;continue;
      }
      root.querySelector('.cp-status').textContent=this.status;
      root.querySelector('.cp-channel').textContent=this.state.link?`Discord voice: ${this.state.link.channelName} (${this.state.link.voiceChannelId}) · Campaign ${this.state.link.campaignId}`:'';
      root.querySelector('.cp-pair').textContent=this.pairText;
      root.querySelector('[data-cp="pause"]').textContent=this.state.paused?`Resume display (${this.state.pending.length} buffered)`:'Pause display';
      const list=root.querySelector('.cp-transcripts'),previousScrollTop=list.scrollTop;const follow=list.scrollHeight-list.scrollTop-list.clientHeight<50;
      list.replaceChildren(...this.state.rows.filter(e=>`${e.displayName} ${e.text}`.toLowerCase().includes(this.query)).map(e=>{
        const li=document.createElement('li');li.textContent=`${new Date(e.timestamp).toLocaleTimeString()} · ${e.displayName}${e.uncertain?' [uncertain]':''}\n${e.text}`;return li;
      }));list.scrollTop=follow?list.scrollHeight:previousScrollTop;
      root.querySelector('.cp-index-status').textContent=this.indexStatus;
      const available=this.adapter.accessibleEntries(),allowed=new Set(available.map(e=>e.uuid));
      const refs=this.referenceQuery?searchReferences(available,this.referenceQuery,this.preferences):[
        ...available.filter(e=>this.pins.has(e.uuid)),
        ...this.references.filter(e=>!this.dismissed.has(e.key) && allowed.has(e.uuid) && !this.preferences.excluded?.includes(e.pack)).slice(-30).reverse()
      ];
      root.querySelector('.cp-references').replaceChildren(...refs.map(ref=>{
        const li=document.createElement('li'),name=document.createElement('strong'),source=document.createElement('small');
        name.textContent=ref.name;source.textContent=`${ref.type} · ${ref.source} · ${ref.pack}${ref.speaker?` · ${ref.speaker}`:''}${ref.confidence?` · ${Math.round(ref.confidence*100)}% match`:''}`;
        li.append(name,source);
        for(const [action,label] of [['open','Open document'],['pin',this.pins.has(ref.uuid)?'Unpin':'Pin'],...(ref.key?[['dismiss','Dismiss']]:[])]) {
          const b=document.createElement('button');b.type='button';b.dataset.cp=action;b.dataset.uuid=ref.uuid;b.dataset.key=ref.key;b.textContent=label;li.append(b);
        }return li;
      }));
      const select=root.querySelector('.cp-session'),selected=select.value;
      select.replaceChildren(...this.sessions.map(s=>{const option=document.createElement('option');option.value=s.id;option.textContent=`${s.title} · ${s.state} · ${s.id.slice(0,8)}`;return option;}));
      if(this.sessions.some(s=>s.id===selected))select.value=selected;
      root.querySelector('.cp-summaries').textContent=this.journal;
    }
  }
}

Hooks.once('init',()=>{
  game.settings.register(ID,'references',{scope:'world',config:false,type:Object,default:{preferred:[],excluded:[],aliases:{}}});
  try {versionAdapter=resolveSidebarAdapter(foundry,CONFIG,game.release.generation);}
  catch(error) {console.warn(error.message);ui.notifications?.warn(error.message);return;}
  class CopilotTab extends versionAdapter.Base {
    static tabName=ID;
    static DEFAULT_OPTIONS={id:ID,classes:['dm-copilot-tab'],window:{title:'DM Copilot'}};
    static PARTS={panel:{template:`modules/${ID}/templates/sidebar.hbs`}};
    async _prepareContext(){return {};}
    async _onRender(context,options){await super._onRender(context,options);if(game.user.isGM)controller?.mount(this.element);else this.element.replaceChildren();}
  }
  versionAdapter.register(ID,CopilotTab);
});
Hooks.once('ready',()=>{
  if(!game.user.isGM || !versionAdapter)return;
  controller=new CopilotUI();void ui[ID]?.render({force:true});
  const token=sessionStorage.getItem(`${controller.key}:token`),base=sessionStorage.getItem(`${controller.key}:url`);
  if(token && base)void controller.connect(base,token).catch(e=>{controller.status=e.message;controller.update();});
});
Hooks.on('canvasReady',()=>{if(controller?.token){controller.sceneSent=0;void controller.refreshStatus().catch(()=>{});}});
Hooks.on('updateCompendium',()=>{if(controller)void controller.index();});
Hooks.on('updateUser',user=>{if(user.id===game.user.id && !game.user.isGM)controller?.disconnect();});
