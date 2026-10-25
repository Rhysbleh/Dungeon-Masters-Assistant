export const normalize=text=>String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const ordinary=new Set(['shield','light','aid','sleep','alarm','command','friends','message','jump','wish','fear','darkness','silence','guidance','resistance','blade','bless','bane']);
function distance(a,b) {
  if(Math.abs(a.length-b.length)>2) return 3;
  let row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++) {const next=[i];for(let j=1;j<=b.length;j++) next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+Number(a[i-1]!==b[j-1]));row=next;}
  return row[b.length];
}
export function searchReferences(entries,query,{preferred=[],excluded=[],aliases={}}={}) {
  const q=normalize(query);if(!q) return [];
  const priority=e=>{const n=preferred.indexOf(e.pack);return n<0?Number.MAX_SAFE_INTEGER:n;};
  return entries.filter(e=>!excluded.includes(e.pack)).map(e=>{
    const name=normalize(e.name),names=[name,...(aliases[e.uuid]??[]).map(normalize)];
    const confidence=Math.max(...names.map(n=>n===q?1:n.includes(q)?0.9:q.length>=5 && n.length<=100 && distance(n,q)<=2?0.65:0));
    return {...e,confidence,preferred:preferred.includes(e.pack)};
  }).filter(e=>e.confidence>0).sort((a,b)=>b.confidence-a.confidence || priority(a)-priority(b) || a.source.localeCompare(b.source)).slice(0,40);
}
export function detectReferences(entries,text,preferences={}) {
  const speech=` ${normalize(text)} `,cue=/\b(cast|casting|spell|concentrat\w*|attack|monster|creature|condition|ability|use|activate|summon)\b/u.test(speech);
  return entries.filter(e=>!preferences.excluded?.includes(e.pack)).flatMap(e=>{
    const terms=[e.name,...(preferences.aliases?.[e.uuid]??[])].map(normalize).filter(n=>n.length>=3 && n.length<=100);
    let term=terms.find(n=>speech.includes(` ${n} `)),fuzzy=false;
    if(!term && cue) {
      const following=speech.match(/\b(?:cast|casting|summon|activate)\s+([\p{L}\p{N} ]+)/u)?.[1]?.trim().split(' ').slice(0,5)??[];
      term=terms.find(n=>n.length>=6 && !ordinary.has(n) && following.length && distance(n,following.slice(0,n.split(' ').length).join(' '))===1);
      fuzzy=!!term;
    }
    if(!term) return [];
    if(ordinary.has(term) && !/\b(cast|casting|spell|concentrat\w*|activate)\b/u.test(speech)) return [];
    if(!term.includes(' ') && term.length<6 && !cue) return [];
    return [{...e,confidence:fuzzy?0.65:cue?0.95:0.7,preferred:preferences.preferred?.includes(e.pack)??false}];
  }).sort((a,b)=>{
    const priority=e=>{const n=(preferences.preferred??[]).indexOf(e.pack);return n<0?Number.MAX_SAFE_INTEGER:n;};
    return b.confidence-a.confidence || priority(a)-priority(b);
  }).slice(0,20);
}

export class CompendiumAdapter {
  constructor(game,fromUuid) {this.game=game;this.fromUuid=fromUuid;this.entries=[];this.loading=null;}
  allowed(pack) {return !!this.game.user?.isGM && !!pack?.visible && pack.testUserPermission(this.game.user,'OBSERVER');}
  async index(excluded=[]) {
    if(this.loading) return this.loading;
    this.loading=(async()=>{
      const entries=[],failures=[];
      for(const pack of this.game.packs.values()) {
        if(!this.allowed(pack) || excluded.includes(pack.collection)) continue;
        try {
          const index=await pack.getIndex();
          if(!this.allowed(pack)) continue;
          for(const item of index.values()) {
            if(entries.length>=50000) {failures.push('Index capped at 50,000 names; exclude unused packs');break;}
            entries.push({name:item.name,uuid:pack.getUuid(item._id),pack:pack.collection,source:pack.title,type:item.type??pack.documentName,documentType:pack.documentName,system:this.game.system.id,systemVersion:this.game.system.version});
          }
        } catch {failures.push(pack.title);}
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      this.entries=entries;return {entries,failures};
    })();
    try{return await this.loading;}finally{this.loading=null;}
  }
  accessibleEntries() {return this.entries.filter(e=>this.allowed(this.game.packs.get(e.pack)));}
  async document(uuid) {
    const entry=this.accessibleEntries().find(e=>e.uuid===uuid);if(!entry) throw new Error('Reference is no longer accessible');
    const doc=await this.fromUuid(uuid);
    if(!doc || !doc.testUserPermission(this.game.user,'OBSERVER') || !this.allowed(this.game.packs.get(entry.pack))) throw new Error('Document access denied');
    return doc;
  }
  async open(uuid) {const doc=await this.document(uuid);if(!doc.sheet) throw new Error('This document has no native sheet');return doc.sheet.render(true);}
}
