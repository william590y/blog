/** FMOD Ex ABI bridge for the original ARM libnttod.so; no game logic lives here.
 * Browser decoding uses WebAudio. Node and explicit enabled:false use a disclosed
 * silent timing backend; opaque FMOD objects and completion callbacks still work.
 * The 0x88-byte create-info layout is verified against HGFmodMgr::loadSound.
 */
export const FMOD = Object.freeze({OK:0, FILE_EOF:22, FILE_NOTFOUND:23, FORMAT:25,
  OPENMEMORY:0x800, OPENRAW:0x1000, OPENMEMORY_POINT:0x10000000,
  LOOP_NORMAL:2, LOOP_BIDI:4, MS:1, PCM:2, PCMBYTES:4, RAWBYTES:8});

const ascii = (b,p,n) => String.fromCharCode(...b.subarray(p,p+n));
const asBytes = b => b instanceof Uint8Array ? b : new Uint8Array(b);

/** Synchronous metadata needed by the native game while decoding is pending. */
export function inspectAudio(input, raw = null) {
  const b=asBytes(input), v=new DataView(b.buffer,b.byteOffset,b.byteLength);
  const out={codec:'unknown', type:0, format:2, channels:1, sampleRate:44100,
    bits:16, frames:0, duration:0, byteLength:b.length};
  if (raw) {
    Object.assign(out,{codec:'pcm',channels:raw.channels||1,sampleRate:raw.sampleRate||44100,
      format:raw.format||2,bits:({1:8,2:16,3:24,4:32,5:32})[raw.format||2]||16});
    out.frames=Math.floor(b.length/(out.channels*out.bits/8));
  } else if (b.length>=12 && ascii(b,0,4)==='RIFF' && ascii(b,8,4)==='WAVE') {
    out.codec='wav'; out.type=20;
    let dataSize=0, align=0;
    for(let p=12;p+8<=b.length;) {
      const id=ascii(b,p,4), n=v.getUint32(p+4,true), start=p+8;
      if(start+n>b.length) break;
      if(id==='fmt ' && n>=16) {
        out.channels=v.getUint16(start+2,true); out.sampleRate=v.getUint32(start+4,true);
        align=v.getUint16(start+12,true);out.bits=v.getUint16(start+14,true);
        out.format=v.getUint16(start,true)===3?5:({8:1,16:2,24:3,32:4})[out.bits]||0;
      } else if(id==='data') dataSize+=n;
      p=start+n+(n&1);
    }
    out.frames=align?Math.floor(dataSize/align):0;
  } else if (b.length>=27 && ascii(b,0,4)==='OggS') {
    out.codec='ogg';out.type=15;let granule=0;
    for(let p=0;p+27<=b.length;) {
      if(ascii(b,p,4)!=='OggS') break;
      const segments=b[p+26], body=p+27+segments;
      if(body>b.length) break;
      let size=0;for(let i=0;i<segments;i++) size+=b[p+27+i];
      if(body+size>b.length) break;
      if(size>=30 && b[body]===1 && ascii(b,body+1,6)==='vorbis') {
        out.channels=b[body+11];out.sampleRate=v.getUint32(body+12,true);
      }
      const lo=v.getUint32(p+6,true),hi=v.getUint32(p+10,true);
      if(hi!==0xffffffff && hi<0x200000) granule=Math.max(granule,hi*4294967296+lo);
      p=body+size;
    }
    out.frames=granule;
  }
  out.duration=out.sampleRate?out.frames/out.sampleRate:0;
  return out;
}

export function installAudio(rt, options={}) {
  const now=options.now||(()=>context?.currentTime??((globalThis.performance?.now?.()??Date.now())/1000));
  const readFile=options.readFile||options.fs?.readFile?.bind(options.fs)||(()=>null);
  const systems=new Map(),sounds=new Map(),groups=new Map(),channels=new Map();
  const activeChannels=new Set();
  const pending=new Set(),events=[],diagnostics=[];
  let context=options.audioContext||null, enabled=options.enabled!==false;
  let destroyed=false, totalBytes=0, peakBytes=0;
  const browserAudio=!!(context||globalThis.AudioContext||globalThis.webkitAudioContext);
  if(!browserAudio) enabled=false;
  const log=(code,message)=>{diagnostics.push({code,message});(options.onWarning||options.onLog)?.(message,code);};
  if(!enabled) log('audio-disabled','Audio output is disabled; the original game uses a silent FMOD timing backend.');
  const put=(p,n)=>{if(p)rt.writeU32(p,n>>>0);};
  const bool=(p,n)=>{if(p)rt.writeBytes(p,new Uint8Array([n?1:0]));};
  const f32=(p,x)=>{if(p){const b=new Uint8Array(4);new DataView(b.buffer).setFloat32(0,x,true);rt.writeBytes(p,b);}};
  const handle=(map,obj)=>{const p=rt.alloc(4);rt.writeU32(p,0);obj.handle=p;map.set(p,obj);return p;};
  const makeGroup=(system,name)=>handle(groups,{system,name,volume:1,paused:false});
  const scratch=rt.alloc(16), transfer=rt.alloc(65536);

  function customRead(namePointer,ex) {
    const open=rt.readU32(ex+0x4c),close=rt.readU32(ex+0x50),read=rt.readU32(ex+0x54);
    if(!open||!read) return null;
    for(let i=0;i<16;i+=4)rt.writeU32(scratch+i,0);
    const result=rt.call(open,[namePointer,0,scratch,scratch+4,scratch+8]);
    if(result!==FMOD.OK) return null;
    const length=rt.readU32(scratch),file=rt.readU32(scratch+4),userdata=rt.readU32(scratch+8);
    try {
      if(length>64*1024*1024) throw new Error(`Sound exceeds 64 MiB (${length} bytes)`);
      const bytes=new Uint8Array(length);let offset=0;
      while(offset<length) {
        const size=Math.min(65536,length-offset);rt.writeU32(scratch+12,0);
        const code=rt.call(read,[file,transfer,size,scratch+12,userdata]);
        const count=rt.readU32(scratch+12);
        if(count>size) throw new Error('FMOD read callback exceeded requested byte count');
        if(count) bytes.set(rt.readBytes(transfer,count),offset);
        offset+=count;
        if(code!==0&&code!==FMOD.FILE_EOF) throw new Error(`FMOD read callback returned ${code}`);
        if(!count||code===FMOD.FILE_EOF) break;
      }
      if(offset!==length) throw new Error(`Truncated sound: read ${offset}/${length}`);
      return bytes;
    } finally {if(close)rt.call(close,[file,userdata]);}
  }

  function elapsed(ch,t=now()) {return ch.position+(!ch.effectivePaused&&ch.playing?(t-ch.started):0);}
  function stopNode(ch) {
    if(ch.source){ch.source.onended=null;try{ch.source.stop();}catch{}ch.source.disconnect();ch.source=null;}
    if(ch.gain){ch.gain.disconnect();ch.gain=null;}
  }
  function volume(ch) {
    const group=groups.get(ch.sound.group),master=groups.get(systems.get(ch.system)?.master);
    return ch.volume*(group?.volume??1)*(master?.volume??1);
  }
  function startNode(ch) {
    stopNode(ch);
    if(!enabled||!context||!ch.sound.buffer||!ch.playing||ch.effectivePaused) return;
    const duration=ch.sound.meta.duration;
    if(!duration) return;
    const current=elapsed(ch),total=ch.loops<0?Infinity:duration*(ch.loops+1);
    if(current>=total) return;
    const source=context.createBufferSource(),gain=context.createGain();
    source.buffer=ch.sound.buffer;source.loop=ch.loops!==0;
    gain.gain.value=volume(ch);source.connect(gain);gain.connect(context.destination);
    ch.source=source;ch.gain=gain;
    if(Number.isFinite(total)) source.start(0,current%duration,total-current);
    else source.start(0,current%duration);
  }
  function updatePause(ch) {
    const paused=ch.paused||!!groups.get(systems.get(ch.system)?.master)?.paused;
    if(paused===ch.effectivePaused) return;
    ch.position=elapsed(ch);ch.started=now();ch.effectivePaused=paused;startNode(ch);
  }
  function finish(ch,notify=true) {
    if(!ch.playing)return;
    ch.position=elapsed(ch);ch.playing=false;activeChannels.delete(ch);stopNode(ch);
    if(notify&&ch.callback)events.push({channel:ch,callback:ch.callback});
  }
  function tick() {
    const t=now();
    for(const ch of activeChannels) {
      if(ch.playing&&!ch.effectivePaused&&ch.loops>=0&&ch.sound.meta.duration>0&&
        elapsed(ch,t)>=ch.sound.meta.duration*(ch.loops+1))finish(ch);
    }
    // Invoke native callbacks only from native System::update, never from a
    // WebAudio event or promise completion while the CPU may be executing.
    const ready=events.splice(0);
    for(const {channel,callback}of ready)rt.call(callback,[channel.handle,0,0,0,0]);
  }
  function decode(sound) {
    if(!enabled||!context||sound.decoding||sound.buffer||sound.failed||!sound.bytes)return;
    sound.decoding=true;
    const p=(async()=>{
      try {
        let buffer;
        if(sound.raw) {
          const m=sound.meta;buffer=context.createBuffer(m.channels,m.frames,m.sampleRate);
          const v=new DataView(sound.bytes.buffer,sound.bytes.byteOffset,sound.bytes.byteLength),width=m.bits/8;
          for(let c=0;c<m.channels;c++) {
            const out=buffer.getChannelData(c);
            for(let i=0;i<m.frames;i++) {
              const pos=(i*m.channels+c)*width;
              if(m.format===5)out[i]=v.getFloat32(pos,true);
              else if(width===1)out[i]=v.getInt8(pos)/128;
              else if(width===2)out[i]=v.getInt16(pos,true)/32768;
              else if(width===3){let x=v.getUint8(pos)|(v.getUint8(pos+1)<<8)|(v.getInt8(pos+2)<<16);out[i]=x/8388608;}
              else out[i]=v.getInt32(pos,true)/2147483648;
            }
          }
        }else{
          const copy=sound.bytes.slice();
          buffer=await context.decodeAudioData(copy.buffer);
        }
        if(!sounds.has(sound.handle)||destroyed)return;
        sound.buffer=buffer;
        // decodeAudioData may resample to the AudioContext's rate. FMOD lengths
        // and PCM seek positions still use the original stream's sample rate.
        if(!sound.meta.frames||!sound.meta.sampleRate)Object.assign(sound.meta,{duration:buffer.duration,
          frames:buffer.length,sampleRate:buffer.sampleRate,channels:buffer.numberOfChannels});
        for(const ch of activeChannels)if(ch.sound===sound)startNode(ch);
      }catch(error){sound.failed=true;log('decode-failed',`Audio unavailable for ${sound.name}: ${error.message||error}`);}
      finally{sound.decoding=false;}
    })();
    pending.add(p);p.finally(()=>pending.delete(p));
  }
  function createSound(c) {
    const system=c.argU32(0),pointer=c.argU32(1),mode=c.argU32(2),ex=c.argU32(3),out=c.argU32(4);
    const exSize=ex?rt.readU32(ex):0, field=(offset)=>ex&&exSize>=offset+4?rt.readU32(ex+offset):0;
    let bytes,name;
    try {
      if(mode&(FMOD.OPENMEMORY|FMOD.OPENMEMORY_POINT)) {
        const length=field(4);if(!length||length>64*1024*1024)return FMOD.FORMAT;
        bytes=asBytes(rt.readBytes(pointer,length)).slice();name=`memory:${pointer.toString(16)}`;
      }else{
        name=rt.readCString(pointer);
        // The game supplies callbacks that open compressed entries in audio.sca.
        bytes=field(0x4c)&&field(0x54)?customRead(pointer,ex):readFile(name);
        if(bytes)bytes=asBytes(bytes).slice();
      }
      if(!bytes){put(out,0);log('file-missing',`Audio asset not found: ${name}`);return FMOD.FILE_NOTFOUND;}
      const offset=field(8);if(offset)bytes=bytes.subarray(offset);
      const raw=(mode&FMOD.OPENRAW)?{channels:field(12),sampleRate:field(16),format:field(20)}:null;
      const meta=inspectAudio(bytes,raw);
      const sound={system,name,mode,group:field(0x68),bytes,raw,meta,buffer:null,failed:false,decoding:false};
      put(out,handle(sounds,sound));totalBytes+=bytes.length;peakBytes=Math.max(peakBytes,totalBytes);
      if(!meta.duration)log('duration-unknown',`Audio duration could not be parsed synchronously: ${name}`);
      decode(sound);return FMOD.OK;
    }catch(error){put(out,0);log('load-failed',`Audio load failed for ${name||'buffer'}: ${error.message||error}`);return FMOD.FORMAT;}
  }
  function releaseSound(sound) {
    if(!sound)return;
    for(const ch of activeChannels)if(ch.sound===sound)finish(ch,false);
    totalBytes-=sound.bytes?.length||0;sound.bytes=null;sound.buffer=null;sounds.delete(sound.handle);
  }
  const api={
    FMOD_Memory_Initialize:()=>0,
    FMOD_Memory_GetStats:c=>{put(c.argU32(0),totalBytes);put(c.argU32(1),peakBytes);return 0;},
    FMOD_System_Create:c=>{const system={master:0};const h=handle(systems,system);system.master=makeGroup(h,'Master');put(c.argU32(0),h);return 0;},
    _ZN4FMOD6System16setDSPBufferSizeEji:()=>0,
    _ZN4FMOD6System9setOutputE15FMOD_OUTPUTTYPE:()=>0,
    _ZN4FMOD6System4initEijPv:()=>0,
    _ZN4FMOD6System16createSoundGroupEPKcPPNS_10SoundGroupE:c=>{put(c.argU32(2),makeGroup(c.argU32(0),rt.readCString(c.argU32(1))));return 0;},
    _ZN4FMOD6System11createSoundEPKcjP22FMOD_CREATESOUNDEXINFOPPNS_5SoundE:createSound,
    _ZN4FMOD5Sound7releaseEv:c=>{releaseSound(sounds.get(c.argU32(0)));return 0;},
    _ZN4FMOD10SoundGroup7releaseEv:c=>{groups.delete(c.argU32(0));return 0;},
    _ZN4FMOD6System7releaseEv:c=>{const h=c.argU32(0);for(const s of sounds.values())if(s.system===h)releaseSound(s);for(const g of groups.values())if(g.system===h)groups.delete(g.handle);systems.delete(h);return 0;},
    _ZN4FMOD6System9playSoundE17FMOD_CHANNELINDEXPNS_5SoundEbPPNS_7ChannelE:c=>{
      const sound=sounds.get(c.argU32(2));if(!sound){put(c.argU32(4),0);return FMOD.FORMAT;}
      const ch={system:c.argU32(0),sound,paused:!!c.argU32(3),effectivePaused:!!c.argU32(3),
        volume:1,loops:sound.mode&6?-1:0,priority:128,userData:0,callback:0,position:0,started:now(),playing:true,source:null,gain:null};
      put(c.argU32(4),handle(channels,ch));activeChannels.add(ch);updatePause(ch);startNode(ch);return 0;
    },
    _ZN4FMOD7Channel4stopEv:c=>{const ch=channels.get(c.argU32(0));if(ch)finish(ch);return 0;},
    _ZN4FMOD7Channel11setUserDataEPv:c=>{const ch=channels.get(c.argU32(0));if(ch)ch.userData=c.argU32(1);return 0;},
    _ZN4FMOD7Channel11getUserDataEPPv:c=>{put(c.argU32(1),channels.get(c.argU32(0))?.userData||0);return 0;},
    _ZN4FMOD7Channel11setCallbackEPF11FMOD_RESULTP12FMOD_CHANNEL25FMOD_CHANNEL_CALLBACKTYPEPvS5_E:c=>{const ch=channels.get(c.argU32(0));if(ch)ch.callback=c.argU32(1);return 0;},
    _ZN4FMOD7Channel9setVolumeEf:c=>{const ch=channels.get(c.argU32(0));if(ch){ch.volume=c.argF32(1);if(ch.gain)ch.gain.gain.value=volume(ch);}return 0;},
    _ZN4FMOD7Channel9getVolumeEPf:c=>{f32(c.argU32(1),channels.get(c.argU32(0))?.volume??0);return 0;},
    _ZN4FMOD7Channel12setLoopCountEi:c=>{const ch=channels.get(c.argU32(0));if(ch){ch.loops=c.argI32(1);startNode(ch);}return 0;},
    _ZN4FMOD7Channel11setPriorityEi:c=>{const ch=channels.get(c.argU32(0));if(ch)ch.priority=c.argI32(1);return 0;},
    _ZN4FMOD7Channel9setPausedEb:c=>{const ch=channels.get(c.argU32(0));if(ch){ch.paused=!!c.argU32(1);updatePause(ch);}return 0;},
    _ZN4FMOD7Channel9getPausedEPb:c=>{bool(c.argU32(1),channels.get(c.argU32(0))?.paused??false);return 0;},
    _ZN4FMOD7Channel9isPlayingEPb:c=>{const ch=channels.get(c.argU32(0));bool(c.argU32(1),ch?.playing??false);return 0;},
    _ZN4FMOD5Sound9getLengthEPjj:c=>{
      const m=sounds.get(c.argU32(0))?.meta,u=c.argU32(2);let length=0;
      if(m)length=u&FMOD.MS?Math.round(m.duration*1000):u&FMOD.PCM?m.frames:u&FMOD.PCMBYTES?m.frames*m.channels*m.bits/8:m.byteLength;
      put(c.argU32(1),length);return 0;
    },
    _ZN4FMOD5Sound9getFormatEP15FMOD_SOUND_TYPEP17FMOD_SOUND_FORMATPiS5_:c=>{
      const m=sounds.get(c.argU32(0))?.meta;put(c.argU32(1),m?.type||0);put(c.argU32(2),m?.format||0);put(c.argU32(3),m?.channels||0);put(c.argU32(4),m?.bits||0);return 0;
    },
    _ZN4FMOD7Channel11setPositionEjj:c=>{
      const ch=channels.get(c.argU32(0));if(ch){const p=c.argU32(1),u=c.argU32(2),m=ch.sound.meta;
        ch.position=u&FMOD.MS?p/1000:u&FMOD.PCM?p/m.sampleRate:u&FMOD.PCMBYTES?p/(m.sampleRate*m.channels*m.bits/8):p/Math.max(m.byteLength,1)*m.duration;
        ch.started=now();startNode(ch);}return 0;
    },
    _ZN4FMOD6System21getMasterChannelGroupEPPNS_12ChannelGroupE:c=>{put(c.argU32(1),systems.get(c.argU32(0))?.master||0);return 0;},
    _ZN4FMOD12ChannelGroup9setPausedEb:c=>{const g=groups.get(c.argU32(0));if(g){g.paused=!!c.argU32(1);for(const ch of activeChannels)updatePause(ch);}return 0;},
    _ZN4FMOD10SoundGroup9getVolumeEPf:c=>{f32(c.argU32(1),groups.get(c.argU32(0))?.volume??0);return 0;},
    _ZN4FMOD10SoundGroup9setVolumeEf:c=>{const g=groups.get(c.argU32(0));if(g){g.volume=c.argF32(1);for(const ch of activeChannels)if(ch.gain)ch.gain.gain.value=volume(ch);}return 0;},
    _ZN4FMOD6System6updateEv:()=>{tick();return 0;},
  };
  for(const [name,fn]of Object.entries(api))rt.registerImport(name,fn);
  return {
    imports:Object.keys(api),diagnostics,systems,sounds,groups,channels,
    get status(){return {mode:!enabled?'disabled':!context?'locked':context.state,
      sounds:sounds.size,decoded:[...sounds.values()].filter(s=>s.buffer).length,
      failed:[...sounds.values()].filter(s=>s.failed).length,pending:pending.size};},
    async unlock(){
      if(!enabled||destroyed)return false;
      if(!context){
        const previousTime=now();
        const Constructor=globalThis.AudioContext||globalThis.webkitAudioContext;context=new Constructor();
        for(const ch of activeChannels){ch.position=elapsed(ch,previousTime);ch.started=now();}
      }
      await context.resume();for(const sound of sounds.values())decode(sound);
      await Promise.all([...pending]);for(const ch of activeChannels)startNode(ch);return true;
    },
    async waitForDecode(){await Promise.all([...pending]);},
    update:tick,
    dispose(){destroyed=true;for(const ch of activeChannels)finish(ch,false);events.length=0;activeChannels.clear();channels.clear();sounds.clear();groups.clear();systems.clear();if(!options.audioContext)context?.close?.();},
  };
}
