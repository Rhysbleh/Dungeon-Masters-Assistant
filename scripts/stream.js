export async function consumeSSE(response,onEvent,signal) {
  if(!response.ok) throw Object.assign(new Error(`Backend HTTP ${response.status}`),{status:response.status});
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
  try {
    while(!signal.aborted) {
      let timedOut=false;
      const timeout=setTimeout(()=>{timedOut=true;void reader.cancel();},30000);
      let chunk;try{chunk=await reader.read();}finally{clearTimeout(timeout);}
      if(timedOut) throw new Error('Transcript heartbeat timed out');
      const {value,done}=chunk;if(done) break;
      buffer+=decoder.decode(value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');
      if(buffer.length>2000000) throw new Error('Oversized event stream');
      let end;
      while((end=buffer.indexOf('\n\n'))>=0) {
        const block=buffer.slice(0,end);buffer=buffer.slice(end+2);
        const lines=block.split('\n'),type=lines.find(s=>s.startsWith('event:'))?.slice(6).trim();
        const data=lines.filter(s=>s.startsWith('data:')).map(s=>s.slice(5).trimStart()).join('\n');
        if(data) await onEvent(type,JSON.parse(data));
      }
    }
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}

// Cursor and display state stay together in memory: a page reload replays persisted backend history.
export class TranscriptState {
  constructor(){this.reset();this.paused=false;this.pending=[];}
  reset(link=null){this.link=link;this.cursor=0;this.rows=[];this.pending=[];}
  accept(event) {
    if(!this.link || event.linkId!==this.link.id || event.campaignId!==this.link.campaignId || event.worldId!==this.link.worldId || !Number.isSafeInteger(event.sequence) || event.sequence<=this.cursor || event.status!=='final') return false;
    this.cursor=event.sequence;
    const list=this.paused?this.pending:this.rows;list.push(event);if(list.length>500) list.shift();
    return true;
  }
  resume(){this.paused=false;this.rows.push(...this.pending);this.rows=this.rows.slice(-500);this.pending=[];}
}
