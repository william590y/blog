/* Android/Bionic compatibility for the original ARM game. No game logic lives here. */
import {zinflate,zdeflate,ZStream,crc32 as pakoCrc32,zmessages} from './vendor/pako-zlib.mjs';
const utf8=new TextEncoder(), decoder=new TextDecoder();
const E={ENOENT:2,EIO:5,EBADF:9,EAGAIN:11,EACCES:13,EEXIST:17,ENOTDIR:20,EISDIR:21,EINVAL:22,ESPIPE:29,ENOSYS:38};
const nowSeconds=()=>Math.floor(Date.now()/1000);
function normalize(path,cwd='/data/files'){const parts=(path.startsWith('/')?path:cwd+'/'+path).split('/'),out=[];for(const x of parts){if(x==='..')out.pop();else if(x&&x!=='.')out.push(x)}return '/'+out.join('/')}
export class MemoryFS {
  constructor(files=new Map(),onSave){
    this.nodes=new Map();
    this.directories=new Set(['/','/data','/data/files','/data/files/assets','/data/cache','/data/external','/tmp']);
    this.cwd='/data/files';this.onSave=onSave;this.revision=0;this.savedRevision=0;this.nextInode=2;
    for(const [path,data] of files)this.mount(path,data);
  }
  addParents(path){let parent=path;while((parent=parent.slice(0,parent.lastIndexOf('/'))))this.directories.add(parent);}
  mount(path,data){path=normalize(path,this.cwd);this.nodes.set(path,{data:new Uint8Array(data),mode:0o100644,mtime:nowSeconds(),writable:false,inode:this.nextInode++});this.addParents(path);}
  restoreWritable(files){for(const [path,data] of files){this.mount(path,data);this.nodes.get(normalize(path,this.cwd)).writable=true;}return this;}
  markDirty(){this.revision++;}
  path(path){const assetAlias=!path.includes('/')||path.startsWith('assets/')||path.startsWith('/assets/');path=normalize(path,this.cwd);if(this.nodes.has(path)||this.directories.has(path))return path;const file=path.split('/').pop();if(assetAlias)for(const prefix of ['/data/files/assets/','/assets/']){if(this.nodes.has(prefix+file))return prefix+file;}return path;}
  get(path){return this.nodes.get(this.path(path));}
  exists(path){path=this.path(path);return this.nodes.has(path)||this.directories.has(path);}
  readFile(path){return this.get(path)?.data??null;}
  writeFile(path,data){path=normalize(path,this.cwd);const old=this.nodes.get(path);this.nodes.set(path,{data:new Uint8Array(data),mode:old?.mode??0o100644,mtime:nowSeconds(),writable:true,inode:old?.inode??this.nextInode++});this.addParents(path);this.markDirty();return path;}
  delete(path){path=this.path(path);const node=this.nodes.get(path);if(!node)return false;this.nodes.delete(path);if(node.writable)this.markDirty();return true;}
  exportWritable(){return new Map([...this.nodes].filter(([,n])=>n.writable).map(([p,n])=>[p,n.data.slice()]));}
  flush(){
    if(!this.onSave||this.savedRevision===this.revision)return;
    const revision=this.revision,result=this.onSave(this.exportWritable());
    this.savedRevision=revision;
    // The callback may enqueue IndexedDB work. Host code owns error reporting and retry.
    return result;
  }
}
export function installLibc(rt,options={}) {
 const fs=options.fs instanceof MemoryFS?options.fs:new MemoryFS(options.fs??options.files??new Map(),options.onSave);
 if(options.onSave)fs.onSave=options.onSave;
 if(options.saves)fs.restoreWritable(options.saves);
 const log=options.onLog??(s=>console.log(s));
 const imports=new Map(), allocations=new Map(),freeBlocks=[],files=new Map(),streams=new Map(),mutexes=new Map(),conditions=new Set(),tls=new Map(),regexes=new Map(),zstreams=new Map(),atExit=[];
 const emptyBytes=new Uint8Array();
 const read=(p,n)=>n?rt.view(p>>>0,n>>>0):emptyBytes,write=(p,b)=>{if(b.length)rt.writeBytes(p>>>0,b)},u32=p=>rt.readU32(p>>>0),w32=(p,v)=>rt.writeU32(p>>>0,v>>>0);
 const rstr=(p)=>p?rt.readCString(p>>>0):'';
 const malloc=n=>{n=Math.max(8,Math.ceil((n>>>0)/8)*8);let i=freeBlocks.findIndex(b=>b.size>=n);let p;if(i>=0){const b=freeBlocks.splice(i,1)[0];p=b.ptr;if(b.size-n>=8)freeBlocks.push({ptr:p+n,size:b.size-n})}else p=rt.alloc(n,8);allocations.set(p,n);return p};
 const free=p=>{if(!p)return;const n=allocations.get(p);if(n===undefined)throw Error('Invalid or double free 0x'+p.toString(16));allocations.delete(p);freeBlocks.push({ptr:p,size:n});freeBlocks.sort((a,b)=>a.ptr-b.ptr);for(let i=0;i+1<freeBlocks.length;){if(freeBlocks[i].ptr+freeBlocks[i].size===freeBlocks[i+1].ptr){freeBlocks[i].size+=freeBlocks[i+1].size;freeBlocks.splice(i+1,1)}else i++}};
 const allocString=s=>{const b=utf8.encode(s+'\0'),p=malloc(b.length);write(p,b);return p};
 const errno=rt.alloc(4,4);w32(errno,0);const fail=(e,ret=-1)=>{w32(errno,e);return ret};
 const reg=(name,fn)=>{imports.set(name,fn);return rt.registerImport(name,fn)};
 const data=(name,p)=>rt.registerDataSymbol(name,p);
 // Views remain local to a synchronous import; no guest callbacks can grow memory
 // while they are in use. Every view is limited to a validated mapped region.
 const span=p=>{p>>>=0;const region=rt.region(p);return rt.view(p,region.address+region.size-p);};
 const strlen=p=>{let length=0;for(;;){const bytes=span(p+length),end=bytes.indexOf(0);if(end>=0)return length+end;length+=bytes.length;}};
 const strnlen=(p,n)=>{let length=0;while(length<n){const bytes=span(p+length),part=bytes.length>n-length?bytes.subarray(0,n-length):bytes,end=part.indexOf(0);if(end>=0)return length+end;length+=part.length;}return length;};
 const strcmp=(a,b,n=Infinity,ci=false)=>{
   let offset=0;
   while(offset<n){
     const left=span(a+offset),right=span(b+offset),length=Math.min(left.length,right.length,n-offset);
     for(let i=0;i<length;i++){
       let x=left[i],y=right[i];
       if(ci){if(x>=65&&x<=90)x+=32;if(y>=65&&y<=90)y+=32;}
       if(x!==y)return x-y;
       if(!x)return 0;
     }
     offset+=length;
   }
   return 0;
 };
 const copy=(d,s,n)=>{if(n)rt.view(d,n).set(rt.view(s,n));return d;};
 const memset=(d,c,n)=>{if(n)rt.view(d,n).fill(c);return d;};
 const strchar=(p,ch,reverse=false)=>{
   let offset=0,result=0;
   for(;;){
     const bytes=span(p+offset),end=bytes.indexOf(0),limit=end<0?bytes.length:end+1;
     const portion=end<0?bytes:bytes.subarray(0,limit),found=reverse?portion.lastIndexOf(ch):portion.indexOf(ch);
     if(found>=0){result=p+offset+found;if(!reverse)return result;}
     if(end>=0)return result;
     offset+=limit;
   }
 };
 reg('malloc',c=>malloc(c.argU32(0)));reg('free',c=>{free(c.argU32(0));return 0});
 reg('calloc',c=>{const n=c.argU32(0)*c.argU32(1);if(n>0xffffffff)return fail(12,0);const p=malloc(n);memset(p,0,n);return p});
 reg('realloc',c=>{const p=c.argU32(0),n=c.argU32(1);if(!p)return malloc(n);if(!n){free(p);return 0}const old=allocations.get(p);if(old===undefined)throw Error('realloc of unknown pointer');if(n<=old)return p;const q=malloc(n);copy(q,p,old);free(p);return q});
 for(const name of ['memcpy','memmove','__aeabi_memcpy','__aeabi_memcpy4','__aeabi_memcpy8','__aeabi_memmove','__aeabi_memmove4'])reg(name,c=>copy(c.argU32(0),c.argU32(1),c.argU32(2)));
 reg('memset',c=>memset(c.argU32(0),c.argU32(1),c.argU32(2)));
 for(const name of ['__aeabi_memset','__aeabi_memset4','__aeabi_memset8'])reg(name,c=>memset(c.argU32(0),c.argU32(2),c.argU32(1)));
 for(const name of ['__aeabi_memclr','__aeabi_memclr4','__aeabi_memclr8'])reg(name,c=>memset(c.argU32(0),0,c.argU32(1)));
 reg('memcmp',c=>{const a=read(c.argU32(0),c.argU32(2)),b=read(c.argU32(1),c.argU32(2));for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]-b[i];return 0});
 reg('memchr',c=>{const p=c.argU32(0),a=read(p,c.argU32(2)),i=a.indexOf(c.argU32(1)&255);return i<0?0:p+i});
 reg('strlen',c=>strlen(c.argU32(0)));reg('strcmp',c=>strcmp(c.argU32(0),c.argU32(1)));reg('strncmp',c=>strcmp(c.argU32(0),c.argU32(1),c.argU32(2)));
 reg('strcasecmp',c=>strcmp(c.argU32(0),c.argU32(1),Infinity,true));reg('strncasecmp',c=>strcmp(c.argU32(0),c.argU32(1),c.argU32(2),true));
 reg('strcpy',c=>copy(c.argU32(0),c.argU32(1),strlen(c.argU32(1))+1));
 reg('strncpy',c=>{const d=c.argU32(0),s=c.argU32(1),n=c.argU32(2),length=strnlen(s,n);copy(d,s,length);if(length<n)memset(d+length,0,n-length);return d});
 reg('strdup',c=>{const s=c.argU32(0),p=malloc(strlen(s)+1);copy(p,s,strlen(s)+1);return p});
 reg('strcat',c=>{const d=c.argU32(0),s=c.argU32(1);copy(d+strlen(d),s,strlen(s)+1);return d});
 reg('strchr',c=>strchar(c.argU32(0),c.argU32(1)&255));
 reg('strrchr',c=>strchar(c.argU32(0),c.argU32(1)&255,true));
 reg('strstr',c=>{const p=c.argU32(0),needle=read(c.argU32(1),strlen(c.argU32(1))),hay=read(p,strlen(p));outer:for(let i=0;i<=hay.length-needle.length;i++){for(let j=0;j<needle.length;j++)if(hay[i+j]!==needle[j])continue outer;return p+i}return 0});
 reg('wcslen',c=>{let n=0;while(u32(c.argU32(0)+4*n))n++;return n});
 reg('wcsncmp',c=>{for(let i=0;i<c.argU32(2);i++){const x=u32(c.argU32(0)+4*i),y=u32(c.argU32(1)+4*i);if(x!==y)return x<y?-1:1;if(!x)break}return 0});
 function parseInteger(p,end,base,signed=true){const s=rstr(p),m=/^\s*([+-]?)/.exec(s);let i=m[0].length,neg=m[1]==='-';if(base===0){if(/^0[xX]/.test(s.slice(i))){base=16;i+=2}else base=s[i]==='0'?8:10}else if(base===16&&/^0[xX]/.test(s.slice(i)))i+=2;const start=i;let value=0n;while(i<s.length){const d=parseInt(s[i],36);if(!Number.isFinite(d)||d>=base)break;value=value*BigInt(base)+BigInt(d);i++}if(end)w32(end,p+(i===start?0:i));if(neg)value=-value;return signed?BigInt.asIntN(64,value):BigInt.asUintN(64,value)}
 reg('atoi',c=>Number(BigInt.asIntN(32,parseInteger(c.argU32(0),0,10))));reg('atoll',c=>({u64:BigInt.asUintN(64,parseInteger(c.argU32(0),0,10))}));
 reg('strtol',c=>Number(BigInt.asIntN(32,parseInteger(c.argU32(0),c.argU32(1),c.argU32(2)))));reg('strtoul',c=>Number(BigInt.asUintN(32,parseInteger(c.argU32(0),c.argU32(1),c.argU32(2),false))));
 reg('strtod',c=>{const p=c.argU32(0),m=/^\s*[+-]?(?:(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|inf(?:inity)?|nan)/i.exec(rstr(p));if(c.argU32(1))w32(c.argU32(1),p+(m?m[0].length:0));let value=m?Number(m[0]):0;if(m&&/inf/i.test(m[0]))value=m[0].trim().startsWith('-')?-Infinity:Infinity;return {f64:value}});
 const unary={sqrt:Math.sqrt,cos:Math.cos,sin:Math.sin,tan:Math.tan,asin:Math.asin,acos:Math.acos,atan:Math.atan,floor:Math.floor,ceil:Math.ceil,round:x=>x<0?-Math.floor(-x+.5):Math.floor(x+.5),log:Math.log,exp:Math.exp,fabs:Math.abs};
 for(const [name,fn] of Object.entries(unary)){reg(name,c=>({f64:fn(c.argF64(0))}));reg(name+'f',c=>({f32:fn(c.argF32(0))}))}
 for(const [name,fn] of Object.entries({fmod:(a,b)=>a%b,pow:Math.pow,atan2:Math.atan2})){reg(name,c=>({f64:fn(c.argF64(0),c.argF64(2))}));reg(name+'f',c=>({f32:fn(c.argF32(0),c.argF32(1))}))}
 const writeFloat=(p,v,double=false)=>{const b=new ArrayBuffer(double?8:4),d=new DataView(b);double?d.setFloat64(0,v,true):d.setFloat32(0,v,true);write(p,new Uint8Array(b))};
 reg('modf',c=>{const x=c.argF64(0),i=Math.trunc(x);writeFloat(c.argU32(2),i,true);return {f64:x-i}});reg('modff',c=>{const x=c.argF32(0),i=Math.trunc(x);writeFloat(c.argU32(1),i);return {f32:x-i}});
 reg('frexp',c=>{const x=c.argF64(0);let e=0,m=x;if(x&&Number.isFinite(x)){e=Math.floor(Math.log2(Math.abs(x)))+1;m=x/2**e}w32(c.argU32(2),e);return {f64:m}});reg('isnan',c=>Number(Number.isNaN(c.argF64(0))));
 let rng=0x1234abcd330en;reg('srand48',c=>{rng=(BigInt(c.argU32(0))<<16n)|0x330en;return 0});reg('lrand48',()=>{rng=(rng*0x5deece66dn+11n)&((1n<<48n)-1n);return Number(rng>>17n)});
 reg('__errno',()=>errno);reg('getpid',()=>1);reg('getuid',()=>10000);reg('getenv',()=>0);
 reg('time',c=>{const value=nowSeconds();if(c.argU32(0))w32(c.argU32(0),value);return value});
 reg('gettimeofday',c=>{const ms=Date.now(),p=c.argU32(0);if(p){w32(p,Math.floor(ms/1000));w32(p+4,(ms%1000)*1000)}if(c.argU32(1))memset(c.argU32(1),0,8);return 0});
 reg('clock_gettime',c=>{const id=c.argI32(0),p=c.argU32(1);if(![0,1,2,3,4,5,6,7].includes(id))return fail(E.EINVAL);const ms=id===0?Date.now():performance.now();w32(p,Math.floor(ms/1000));w32(p+4,Math.floor((ms%1000)*1e6));return 0});
 reg('getrusage',c=>{memset(c.argU32(1),0,72);return 0});
 const tm=rt.alloc(44,4);function fillTm(seconds,local){const d=new Date(seconds*1000),prefix=local?'get':'getUTC',fields=[d[prefix+'Seconds'](),d[prefix+'Minutes'](),d[prefix+'Hours'](),d[prefix+'Date'](),d[prefix+'Month'](),d[prefix+'FullYear']()-1900,d[prefix+'Day'](),Math.floor((d-new Date(Date.UTC(d.getUTCFullYear(),0,1)))/86400000),0];fields.forEach((v,i)=>w32(tm+4*i,v));w32(tm+36,local?-d.getTimezoneOffset()*60:0);w32(tm+40,0);return tm}
 reg('gmtime',c=>fillTm(u32(c.argU32(0))|0,false));reg('localtime',c=>fillTm(u32(c.argU32(0))|0,true));reg('mktime',c=>{const p=c.argU32(0),d=new Date((u32(p+20)|0)+1900,u32(p+16)|0,u32(p+12)|0,u32(p+8)|0,u32(p+4)|0,u32(p)|0);return Math.floor(d.getTime()/1000)});
 reg('sleep',c=>{if(c.argU32(0))throw Error('Blocking sleep requires an asynchronous guest scheduler');return 0});
 reg('qsort',c=>{const p=c.argU32(0),n=c.argU32(1),size=c.argU32(2),fn=c.argU32(3);if(n<2)return 0;const temp=malloc(n*size);copy(temp,p,n*size);const indexes=Array.from({length:n},(_,i)=>i);indexes.sort((a,b)=>rt.call(fn,[temp+a*size,temp+b*size])|0);for(let i=0;i<n;i++)copy(p+i*size,temp+indexes[i]*size,size);free(temp);return 0});
 let nextFd=3;const stdout={data:new Uint8Array(),mode:0o100666,mtime:0,writable:true};files.set(0,{node:stdout,pos:0,readable:true,writable:false});files.set(1,{node:stdout,pos:0,readable:false,writable:true,console:1});files.set(2,{node:stdout,pos:0,readable:false,writable:true,console:2});
 const sF=rt.alloc(84*3,4);memset(sF,0,84*3);data('__sF',sF);for(let i=0;i<3;i++){streams.set(sF+i*84,{fd:i,eof:false,error:false});write(sF+i*84+12,new Uint8Array([i===0?4:8,0,i,0]))}
 function openFile(path,flags,mode=0o666){path=fs.path(path);if(fs.directories.has(path))return fail(E.EISDIR);let node=fs.nodes.get(path);if(!node){if(!(flags&64))return fail(E.ENOENT);fs.writeFile(path,new Uint8Array());node=fs.nodes.get(path);node.mode=0o100000|mode}else if((flags&64)&&(flags&128))return fail(E.EEXIST);const readable=(flags&3)!==1,writable=(flags&3)!==0;if((flags&512)&&writable){node.data=new Uint8Array();node.writable=true;fs.markDirty()}const fd=nextFd++;files.set(fd,{node,path,pos:(flags&1024)?node.data.length:0,readable,writable,append:!!(flags&1024)});return fd}
 function fdRead(fd,p,n){const f=files.get(fd);if(!f||!f.readable)return fail(E.EBADF);n=Math.min(n,Math.max(0,f.node.data.length-f.pos));write(p,f.node.data.subarray(f.pos,f.pos+n));f.pos+=n;return n}
 function fdWrite(fd,p,n){const f=files.get(fd);if(!f||!f.writable)return fail(E.EBADF);const b=read(p,n);if(f.console){log(decoder.decode(b));return n}if(f.append)f.pos=f.node.data.length;const end=f.pos+n;if(end>f.node.data.length){const buf=new Uint8Array(end);buf.set(f.node.data);f.node.data=buf}f.node.data.set(b,f.pos);f.pos=end;f.node.mtime=nowSeconds();f.node.writable=true;fs.markDirty();return n}
 function seek(fd,offset,whence){const f=files.get(fd);if(!f)return fail(E.EBADF);if(f.console)return fail(E.ESPIPE);const p=offset+(whence===0?0:whence===1?f.pos:whence===2?f.node.data.length:NaN);if(!Number.isFinite(p)||p<0)return fail(E.EINVAL);f.pos=p;return p}
 function close(fd){if(!files.has(fd))return fail(E.EBADF);files.delete(fd);fs.flush();return 0}
 function makeStream(fd){const p=malloc(84);memset(p,0,84);write(p+14,new Uint8Array([fd&255,(fd>>>8)&255]));streams.set(p,{fd,eof:false,error:false});return p}
 function stream(p){const s=streams.get(p);if(!s){fail(E.EBADF);return null}return s}
 function modeFlags(m){let flags=m.startsWith('w')?1|64|512:m.startsWith('a')?1|64|1024:0;if(m.includes('+'))flags=(flags&~3)|2;if(m.includes('x'))flags|=128;return flags}
 reg('open',c=>openFile(rstr(c.argU32(0)),c.argU32(1),c.argU32(2)||0o666));reg('close',c=>close(c.argI32(0)));reg('read',c=>fdRead(c.argI32(0),c.argU32(1),c.argU32(2)));reg('write',c=>fdWrite(c.argI32(0),c.argU32(1),c.argU32(2)));reg('lseek',c=>seek(c.argI32(0),c.argI32(1),c.argI32(2)));
 reg('dup',c=>{const f=files.get(c.argI32(0));if(!f)return fail(E.EBADF);const n=nextFd++;files.set(n,f);return n});
 reg('fopen',c=>{const fd=openFile(rstr(c.argU32(0)),modeFlags(rstr(c.argU32(1))));return fd<0?0:makeStream(fd)});reg('fdopen',c=>files.has(c.argI32(0))?makeStream(c.argI32(0)):fail(E.EBADF,0));
 reg('fclose',c=>{const p=c.argU32(0),s=stream(p);if(!s)return -1;const r=close(s.fd);streams.delete(p);if(allocations.has(p))free(p);return r});
 reg('fread',c=>{const p=c.argU32(0),size=c.argU32(1),n=c.argU32(2),s=stream(c.argU32(3));if(!s||!size||!n)return 0;const count=fdRead(s.fd,p,size*n);if(count<0){s.error=true;return 0}if(count<size*n)s.eof=true;return Math.floor(count/size)});
 reg('fwrite',c=>{const size=c.argU32(1),s=stream(c.argU32(3));if(!s||!size)return 0;const count=fdWrite(s.fd,c.argU32(0),size*c.argU32(2));if(count<0){s.error=true;return 0}return Math.floor(count/size)});
 reg('fseek',c=>{const s=stream(c.argU32(0));if(!s)return -1;const pos=seek(s.fd,c.argI32(1),c.argI32(2));if(pos<0)return -1;s.eof=false;return 0});reg('ftell',c=>{const s=stream(c.argU32(0));return s?files.get(s.fd)?.pos??fail(E.EBADF):-1});
 reg('clearerr',c=>{const s=stream(c.argU32(0));if(s)s.eof=s.error=false;return 0});reg('feof',c=>Number(!!stream(c.argU32(0))?.eof));reg('ferror',c=>Number(!!stream(c.argU32(0))?.error));
 reg('fflush',c=>{if(c.argU32(0)&&!stream(c.argU32(0)))return -1;fs.flush();return 0});
 reg('fgets',c=>{const p=c.argU32(0),n=c.argI32(1),s=stream(c.argU32(2));if(!s||n<=0)return 0;let i=0;while(i<n-1){const count=fdRead(s.fd,p+i,1);if(count<=0){if(count<0)s.error=true;else s.eof=true;break}if(read(p+i++,1)[0]===10)break}write(p+i,new Uint8Array([0]));return i?p:0});
 const charTemp=malloc(4);function putc(ch,fp){const s=stream(fp);if(!s)return -1;write(charTemp,new Uint8Array([ch&255]));return fdWrite(s.fd,charTemp,1)===1?ch&255:-1}
 reg('fputc',c=>putc(c.argU32(0),c.argU32(1)));reg('putc',c=>putc(c.argU32(0),c.argU32(1)));reg('putchar',c=>putc(c.argU32(0),sF+84));
 reg('fputs',c=>{const s=stream(c.argU32(1));return s?fdWrite(s.fd,c.argU32(0),strlen(c.argU32(0))):-1});reg('puts',c=>{log(rstr(c.argU32(0))+'\n');return strlen(c.argU32(0))+1});
 let temporary=0;reg('tmpfile',()=>{const fd=openFile('/tmp/tmp-'+(++temporary),2|64|512);return makeStream(fd)});
 function stat(node,p,dir=false){memset(p,0,104);w32(p,1);w32(p+12,node?.inode??1);w32(p+16,dir?0o40755:node.mode);w32(p+20,1);w32(p+24,10000);w32(p+28,10000);w32(p+48,node?.data.length??0);w32(p+56,4096);w32(p+64,Math.ceil((node?.data.length??0)/512));for(const off of [72,80,88])w32(p+off,node?.mtime??nowSeconds());w32(p+96,node?.inode??1);return 0}
 reg('stat',c=>{const path=fs.path(rstr(c.argU32(0))),node=fs.nodes.get(path);return node||fs.directories.has(path)?stat(node,c.argU32(1),!node):fail(E.ENOENT)});
 reg('fstat',c=>{const f=files.get(c.argI32(0));return f?stat(f.node,c.argU32(1)):fail(E.EBADF)});
 reg('access',c=>fs.exists(rstr(c.argU32(0)))?0:fail(E.ENOENT));
 const unlink=path=>{path=fs.path(path);if(!fs.nodes.has(path))return fail(E.ENOENT);fs.delete(path);fs.flush();return 0};reg('unlink',c=>unlink(rstr(c.argU32(0))));reg('remove',c=>unlink(rstr(c.argU32(0))));
 reg('rename',c=>{const a=fs.path(rstr(c.argU32(0))),b=normalize(rstr(c.argU32(1)),fs.cwd),n=fs.nodes.get(a);if(!n)return fail(E.ENOENT);fs.nodes.delete(a);fs.nodes.set(b,n);fs.addParents(b);n.writable=true;fs.markDirty();fs.flush();return 0});
 let mask=0o022;reg('umask',c=>{const old=mask;mask=c.argU32(0)&0o777;return old});reg('chmod',c=>{const n=fs.get(rstr(c.argU32(0)));if(!n)return fail(E.ENOENT);n.mode=(n.mode&~0o777)|(c.argU32(1)&0o777);return 0});
 reg('utimes',c=>{const n=fs.get(rstr(c.argU32(0)));if(!n)return fail(E.ENOENT);n.mtime=c.argU32(1)?u32(c.argU32(1)+8):nowSeconds();return 0});
 reg('ftruncate',c=>{const f=files.get(c.argI32(0)),n=c.argI32(1);if(!f||!f.writable)return fail(E.EBADF);if(n<0)return fail(E.EINVAL);const d=new Uint8Array(n);d.set(f.node.data.subarray(0,n));f.node.data=d;f.node.writable=true;fs.markDirty();return 0});
 reg('fsync',c=>{if(!files.has(c.argI32(0)))return fail(E.EBADF);fs.flush();return 0});
 reg('fcntl',c=>{const fd=c.argI32(0),cmd=c.argI32(1),f=files.get(fd);if(!f)return fail(E.EBADF);if(cmd===0){const n=Math.max(nextFd,c.argI32(2));files.set(n,f);nextFd=n+1;return n}if(cmd===1)return 0;if(cmd===2)return 0;if(cmd===3)return (f.writable?(f.readable?2:1):0)|(f.append?1024:0);if(cmd===4){f.append=!!(c.argU32(2)&1024);return 0}if(cmd===5||cmd===12){const p=c.argU32(2);write(p,new Uint8Array([2,0]));return 0}if([6,7,13,14].includes(cmd))return 0;return fail(E.EINVAL)});
 const mapped=new Map();reg('mmap',c=>{const size=c.argU32(1),flags=c.argU32(3),fd=c.argI32(4),offset=c.argU32(5),p=malloc(size);memset(p,0,size);if(!(flags&32)){const f=files.get(fd);if(!f){free(p);return fail(E.EBADF,0xffffffff)}write(p,f.node.data.subarray(offset,offset+size));mapped.set(p,{size,fd,offset,shared:!!(flags&1)})}else mapped.set(p,{size});return p});
 reg('munmap',c=>{const p=c.argU32(0),m=mapped.get(p);if(!m)return fail(E.EINVAL);if(m.shared){const f=files.get(m.fd);if(f){const pos=f.pos;f.pos=m.offset;fdWrite(m.fd,p,m.size);f.pos=pos}}mapped.delete(p);free(p);return 0});
 reg('getcwd',c=>{const n=c.argU32(1),b=utf8.encode(fs.cwd+'\0');if(n<b.length)return fail(34,0);const p=c.argU32(0)||malloc(n);write(p,b);return p});reg('isatty',c=>[0,1,2].includes(c.argI32(0))?1:0);
 const errorStrings=new Map();reg('strerror',c=>{const n=c.argI32(0);if(!errorStrings.has(n))errorStrings.set(n,allocString(({2:'No such file or directory',5:'I/O error',9:'Bad file descriptor',13:'Permission denied',22:'Invalid argument',38:'Function not implemented'})[n]??'Unknown error '+n));return errorStrings.get(n)});
 const pw=rt.alloc(28,4),pwName=allocString('webplayer'),pwHome=allocString('/data/files'),pwShell=allocString('/bin/sh');memset(pw,0,28);w32(pw,pwName);w32(pw+8,10000);w32(pw+12,10000);w32(pw+20,pwHome);w32(pw+24,pwShell);reg('getpwuid',c=>c.argU32(0)===10000?pw:0);
 function argReader(c,start,va=0){let slot=start;return {u32(){const result=va?u32(va+slot*4):c.argU32(slot);slot++;return result},i32(){return this.u32()|0},u64(){slot=va?(((va+slot*4+7)&~7)-va)/4:(slot+1)&~1;const low=this.u32(),high=this.u32();return BigInt(low)+(BigInt(high)<<32n)},f64(){slot=va?(((va+slot*4+7)&~7)-va)/4:(slot+1)&~1;const b=new ArrayBuffer(8),v=new DataView(b);v.setUint32(0,this.u32(),true);v.setUint32(4,this.u32(),true);return v.getFloat64(0,true)}}}
 function format(fmt,args){let output='';for(let i=0;i<fmt.length;){if(fmt[i]!=='%'){output+=fmt[i++];continue}i++;if(fmt[i]==='%'){output+='%';i++;continue}let flags='';while('-+ #0'.includes(fmt[i])&&i<fmt.length)flags+=fmt[i++];let width=0;if(fmt[i]==='*'){width=args.i32();i++;if(width<0){flags+='-';width=-width}}else while(/\d/.test(fmt[i]??'')&&i<fmt.length)width=width*10+Number(fmt[i++]);let precision=null;if(fmt[i]==='.'){i++;precision=0;if(fmt[i]==='*'){precision=args.i32();i++;if(precision<0)precision=null}else while(/\d/.test(fmt[i]??'')&&i<fmt.length)precision=precision*10+Number(fmt[i++])}let length='';while('hljztL'.includes(fmt[i])&&i<fmt.length)length+=fmt[i++];const spec=fmt[i++];let value='',numeric=false,negative=false;
 if('diuoxX'.includes(spec)){const wide=length==='ll'||length==='j';let n=wide?args.u64():BigInt(args.u32());if(spec==='d'||spec==='i')n=BigInt.asIntN(wide?64:32,n);negative=n<0n;if(negative)n=-n;value=n.toString(spec==='o'?8:spec==='x'||spec==='X'?16:10);if(precision===0&&n===0n)value='';if(precision!==null)value=value.padStart(precision,'0');if(spec==='X')value=value.toUpperCase();let sign=negative?'-':(spec==='d'||spec==='i')?(flags.includes('+')?'+':flags.includes(' ')?' ':''):'';let prefix=flags.includes('#')?(spec==='o'&&!value.startsWith('0')?'0':n&&spec==='x'?'0x':n&&spec==='X'?'0X':''):'';value=sign+prefix+value;numeric=true}
 else if('fFeEgGaA'.includes(spec)){let n=args.f64();negative=n<0||Object.is(n,-0);n=Math.abs(n);const p=precision??6;if(!Number.isFinite(n))value=Number.isNaN(n)?'nan':'inf';else if(spec.toLowerCase()==='f')value=n.toFixed(Math.min(100,p));else if(spec.toLowerCase()==='e')value=n.toExponential(Math.min(100,p)).replace(/e([+-])(\d)$/, 'e$10$2');else if(spec.toLowerCase()==='g'){value=n.toPrecision(Math.max(1,Math.min(100,p)));if(!flags.includes('#'))value=value.replace(/(\.\d*?)0+(e|$)/,'$1$2').replace(/\.(e|$)/,'$1')}else throw Error('Unsupported printf hexadecimal float');if(spec===spec.toUpperCase())value=value.toUpperCase();value=(negative?'-':flags.includes('+')?'+':flags.includes(' ')?' ':'')+value;numeric=true}
 else if(spec==='s'){value=rstr(args.u32());if(precision!==null)value=value.slice(0,precision)}else if(spec==='c')value=String.fromCharCode(args.u32()&255);else if(spec==='p'){value='0x'+args.u32().toString(16);numeric=true}else if(spec==='n'){const p=args.u32(),n=utf8.encode(output).length;if(length==='h')write(p,new Uint8Array([n&255,(n>>>8)&255]));else if(length==='hh')write(p,new Uint8Array([n&255]));else w32(p,n);continue}else throw Error('Unsupported printf conversion %'+spec);
 if(width>value.length){const padding=width-value.length;if(flags.includes('-'))value=value+' '.repeat(padding);else if(numeric&&flags.includes('0')&&precision===null){const m=/^([+-]|0[xX])/.exec(value);value=m?m[0]+'0'.repeat(padding)+value.slice(m[0].length):'0'.repeat(padding)+value}else value=' '.repeat(padding)+value}output+=value}return output}
 function sprintf(p,n,value){const b=utf8.encode(value);if(n>0){write(p,b.subarray(0,n-1));write(p+Math.min(n-1,b.length),new Uint8Array([0]))}return b.length}
 reg('sprintf',c=>sprintf(c.argU32(0),0x7fffffff,format(rstr(c.argU32(1)),argReader(c,2))));reg('snprintf',c=>sprintf(c.argU32(0),c.argU32(1),format(rstr(c.argU32(2)),argReader(c,3))));reg('vsnprintf',c=>sprintf(c.argU32(0),c.argU32(1),format(rstr(c.argU32(2)),argReader(c,0,c.argU32(3)))));
 reg('printf',c=>{const s=format(rstr(c.argU32(0)),argReader(c,1));log(s);return utf8.encode(s).length});reg('vprintf',c=>{const s=format(rstr(c.argU32(0)),argReader(c,0,c.argU32(1)));log(s);return utf8.encode(s).length});
 reg('fprintf',c=>{const s=stream(c.argU32(0));if(!s)return -1;const text=format(rstr(c.argU32(1)),argReader(c,2)),p=allocString(text),r=fdWrite(s.fd,p,utf8.encode(text).length);free(p);return r});
 reg('__android_log_print',c=>{const s=format(rstr(c.argU32(2)),argReader(c,3));log('['+rstr(c.argU32(1))+'] '+s);return utf8.encode(s).length});
 reg('sscanf',c=>{const input=rstr(c.argU32(0)),fmt=rstr(c.argU32(1));let pos=0,assigned=0,arg=2;for(let i=0;i<fmt.length;i++){if(/\s/.test(fmt[i])){while(/\s/.test(input[pos]??'')&&pos<input.length)pos++;continue}if(fmt[i]!=='%'){if(input[pos++]!==fmt[i])break;continue}i++;if(fmt[i]==='%'){if(input[pos++]!=='%')break;continue}let suppress=false;if(fmt[i]==='*'){suppress=true;i++}let width='';while(/\d/.test(fmt[i]??''))width+=fmt[i++];let length='';while('hljztL'.includes(fmt[i]??'')&&i<fmt.length)length+=fmt[i++];const spec=fmt[i];if(spec!=='c'&&spec!=='['&&spec!=='n')while(/\s/.test(input[pos]??'')&&pos<input.length)pos++;const remain=input.slice(pos,width?pos+Number(width):undefined);let m,value;if(spec==='n'){if(!suppress)w32(c.argU32(arg++),pos);continue}if('diuoxX'.includes(spec)){m=(spec==='x'||spec==='X')?/^[+-]?(?:0x)?[0-9a-f]+/i.exec(remain):spec==='o'?/^[+-]?[0-7]+/.exec(remain):/^[+-]?\d+/.exec(remain);if(m)value=parseInt(m[0],spec==='o'?8:spec==='x'||spec==='X'?16:10)}else if('eEfFgGaA'.includes(spec)){m=/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(remain);if(m)value=Number(m[0])}else if(spec==='s'){m=/^\S+/.exec(remain);if(m)value=m[0]}else if(spec==='c'){m=remain.length>=(Number(width)||1)?[remain.slice(0,Number(width)||1)]:null;if(m)value=m[0]}else throw Error('Unsupported sscanf conversion %'+spec);if(!m)break;pos+=m[0].length;if(!suppress){const p=c.argU32(arg++);if(spec==='s')write(p,utf8.encode(value+'\0'));else if(spec==='c')write(p,utf8.encode(value));else if('eEfFgGaA'.includes(spec))writeFloat(p,value,length==='l'||length==='L');else if(length==='h')write(p,new Uint8Array([value&255,(value>>>8)&255]));else w32(p,value);assigned++}}return assigned||(!input.length?-1:0)});
 const guard=rt.alloc(4,4);w32(guard,0x39aa1700);data('__stack_chk_guard',guard);
 const ctype=rt.alloc(257,1),lower=rt.alloc(257*2,2),upper=rt.alloc(257*2,2);for(let i=-1;i<256;i++){let f=0;if(i>=65&&i<=90)f|=1;if(i>=97&&i<=122)f|=2;if(i>=48&&i<=57)f|=4;if([9,10,11,12,13,32].includes(i))f|=8;if(i>=0&&(i<32||i===127))f|=32;if(i===32)f|=128;if(i>=48&&i<=57||i>=65&&i<=70||i>=97&&i<=102)f|=64;if(i>=33&&i<=126&&!(f&7))f|=16;write(ctype+i+1,new Uint8Array([f]));const l=i>=65&&i<=90?i+32:i,u=i>=97&&i<=122?i-32:i;write(lower+(i+1)*2,new Uint8Array([l&255,(l>>8)&255]));write(upper+(i+1)*2,new Uint8Array([u&255,(u>>8)&255]))}
 for(const [name,p] of [['_ctype_',ctype],['_tolower_tab_',lower],['_toupper_tab_',upper]]){const q=rt.alloc(4,4);w32(q,p);data(name,q)}
 for(const name of ['abort','exit','__stack_chk_fail'])reg(name,c=>{throw Error('Guest '+name+'('+c.argI32(0)+')')});
 reg('__gnu_Unwind_Find_exidx',c=>{const address=c.argU32(0),count=c.argU32(1);for(const image of rt.images??[]){if(address>=image.base&&address<image.base+image.size){const section=image.sections.find(s=>s.name==='.ARM.exidx');if(section){w32(count,section.size/8);return image.base+section.address}}}w32(count,0);return 0});
 reg('__assert2',c=>{throw Error('Guest assertion '+rstr(c.argU32(3))+' at '+rstr(c.argU32(0))+':'+c.argU32(1)+' '+rstr(c.argU32(2)))});
 reg('raise',c=>{throw Error('Guest signal '+c.argI32(0))});
 const signalHandlers=new Map();reg('bsd_signal',c=>{const sig=c.argI32(0),prev=signalHandlers.get(sig)||0;signalHandlers.set(sig,c.argU32(1));return prev});
 reg('__cxa_atexit',c=>{atExit.push({fn:c.argU32(0),arg:c.argU32(1),dso:c.argU32(2)});return 0});reg('__aeabi_atexit',c=>{atExit.push({fn:c.argU32(1),arg:c.argU32(0),dso:c.argU32(2)});return 0});reg('__cxa_finalize',c=>{const dso=c.argU32(0);for(let i=atExit.length-1;i>=0;i--)if(!dso||atExit[i].dso===dso){const x=atExit.splice(i,1)[0];rt.call(x.fn,[x.arg])}return 0});
 function native(name,words){const p=rt.alloc(words.length*4,4),buf=new Uint8Array(words.length*4),v=new DataView(buf.buffer);words.forEach((w,i)=>v.setUint32(i*4,w,true));write(p,buf);data(name,p)}
 native('setjmp',[0xe8806ff0,0xe3a00000,0xe12fff1e]);native('_setjmp',[0xe8806ff0,0xe3a00000,0xe12fff1e]);native('longjmp',[0xe1a02000,0xe1a00001,0xe3500000,0x03a00001,0xe8926ff0,0xe12fff1e]);
 let nextTls=1;reg('pthread_key_create',c=>{const key=nextTls++;tls.set(key,{value:0,destructor:c.argU32(1)});w32(c.argU32(0),key);return 0});reg('pthread_key_delete',c=>tls.delete(c.argU32(0))?0:E.EINVAL);reg('pthread_getspecific',c=>tls.get(c.argU32(0))?.value??0);reg('pthread_setspecific',c=>{const key=tls.get(c.argU32(0));if(!key)return E.EINVAL;key.value=c.argU32(1);return 0});
 reg('pthread_mutexattr_init',c=>{w32(c.argU32(0),0);return 0});reg('pthread_mutexattr_settype',c=>{if(c.argU32(1)>2)return E.EINVAL;w32(c.argU32(0),c.argU32(1));return 0});reg('pthread_mutexattr_destroy',c=>{w32(c.argU32(0),0xffffffff);return 0});
 reg('pthread_mutex_init',c=>{const p=c.argU32(0);w32(p,0);mutexes.set(p,{type:c.argU32(1)?u32(c.argU32(1)):0,depth:0});return 0});
 function mutex(p){if(!mutexes.has(p))mutexes.set(p,{type:(u32(p)&0x4000)?1:(u32(p)&0x8000)?2:0,depth:0});return mutexes.get(p)}
 reg('pthread_mutex_lock',c=>{const m=mutex(c.argU32(0));if(m.depth&&m.type!==1)throw Error('Single-thread guest attempted to lock an already locked non-recursive mutex');m.depth++;return 0});reg('pthread_mutex_trylock',c=>{const m=mutex(c.argU32(0));if(m.depth&&m.type!==1)return 16;m.depth++;return 0});reg('pthread_mutex_unlock',c=>{const m=mutex(c.argU32(0));if(!m.depth)return 1;m.depth--;return 0});reg('pthread_mutex_destroy',c=>{const p=c.argU32(0);if(mutex(p).depth)return 16;mutexes.delete(p);return 0});
 reg('pthread_cond_init',c=>{const p=c.argU32(0);conditions.add(p);w32(p,0);return 0});reg('pthread_cond_destroy',c=>{conditions.delete(c.argU32(0));return 0});reg('pthread_cond_signal',()=>0);reg('pthread_cond_broadcast',()=>0);
 reg('pthread_cond_wait',()=>{throw Error('Guest condition wait requires a guest thread scheduler')});reg('pthread_create',()=>{throw Error('Guest pthread_create requires a guest thread scheduler')});reg('pthread_join',()=>{throw Error('Guest pthread_join requires a guest thread scheduler')});
 reg('regcomp',c=>{try{let pattern=rstr(c.argU32(1)),flags=c.argU32(2);if(!(flags&1))pattern=pattern.replace(/([()+?|{}])/g,'\\$1').replace(/\\\\([()+?|{}])/g,'$1');regexes.set(c.argU32(0),new RegExp(pattern,(flags&2?'i':'')+(flags&8?'m':'')+'d'));return 0}catch{return 2}});
 reg('regexec',c=>{const regex=regexes.get(c.argU32(0));if(!regex)return 2;const m=regex.exec(rstr(c.argU32(1)));if(!m)return 1;const n=c.argU32(2),p=c.argU32(3);for(let i=0;i<n;i++){w32(p+i*8,m.indices[i]?.[0]??-1);w32(p+i*8+4,m.indices[i]?.[1]??-1)}return 0});reg('regfree',c=>{regexes.delete(c.argU32(0));return 0});
 let dlError=0;reg('dlopen',c=>{const name=rstr(c.argU32(0));if(!name||/^(libc|libm|libdl|liblog|libz|libGLESv2|libnttod)\.so$/.test(name))return 1;dlError=allocString('Library unavailable in browser: '+name);return 0});reg('dlclose',()=>0);reg('dlerror',()=>{const p=dlError;dlError=0;return p});reg('dlsym',c=>{const name=rstr(c.argU32(1));const p=rt.dataSymbols?.get(name)??rt.symbols?.get(name)??rt.imports?.get(name)?.address??0;if(!p)dlError=allocString('Symbol unavailable: '+name);return p});
 const zmsgs=new Map();function zmessage(s){if(!s)return 0;if(!zmsgs.has(s))zmsgs.set(s,allocString(s));return zmsgs.get(s)}
 function zsave(p,z){w32(p,z.guestIn+z.next_in);w32(p+4,z.avail_in);w32(p+8,z.total_in);w32(p+12,z.guestOut+z.next_out);w32(p+16,z.avail_out);w32(p+20,z.total_out);w32(p+24,zmessage(z.msg));w32(p+28,z.state?1:0);w32(p+44,z.data_type);w32(p+48,z.adler)}
 function zstep(p,flush,deflate=false){const z=zstreams.get(p);if(!z)return -2;z.guestIn=u32(p);z.guestOut=u32(p+12);z.input=read(z.guestIn,u32(p+4));z.next_in=0;z.avail_in=u32(p+4);z.output=new Uint8Array(u32(p+16));z.next_out=0;z.avail_out=z.output.length;const result=(deflate?zdeflate.deflate:zinflate.inflate)(z,flush);write(z.guestOut,z.output.subarray(0,z.next_out));zsave(p,z);return result}
 function zinit(p,bits,deflate=false,level=-1,method=8,memLevel=8,strategy=0){const z=new ZStream(),r=deflate?zdeflate.deflateInit2(z,level,method,bits,memLevel,strategy):zinflate.inflateInit2(z,bits);if(r===0){zstreams.set(p,z);w32(p+8,0);w32(p+20,0);w32(p+24,0);w32(p+28,1);w32(p+44,z.data_type);w32(p+48,z.adler)}return r}
 reg('inflateInit_',c=>c.argU32(2)===56?zinit(c.argU32(0),15):-6);reg('inflateInit2_',c=>c.argU32(3)===56?zinit(c.argU32(0),c.argI32(1)):-6);
 reg('inflate',c=>zstep(c.argU32(0),c.argI32(1)));reg('inflateReset',c=>{const p=c.argU32(0),z=zstreams.get(p);if(!z)return -2;const r=zinflate.inflateReset(z);w32(p+8,0);w32(p+20,0);w32(p+48,z.adler);return r});reg('inflateEnd',c=>{const p=c.argU32(0),z=zstreams.get(p);if(!z)return -2;const r=zinflate.inflateEnd(z);zstreams.delete(p);w32(p+28,0);return r});
 reg('deflateInit2_',c=>c.argU32(7)===56?zinit(c.argU32(0),c.argI32(3),true,c.argI32(1),c.argI32(2),c.argI32(4),c.argI32(5)):-6);
 reg('deflate',c=>zstep(c.argU32(0),c.argI32(1),true));reg('deflateReset',c=>{const p=c.argU32(0),z=zstreams.get(p);if(!z)return -2;const r=zdeflate.deflateReset(z);w32(p+8,0);w32(p+20,0);w32(p+48,z.adler);return r});reg('deflateEnd',c=>{const p=c.argU32(0),z=zstreams.get(p);if(!z)return -2;const r=zdeflate.deflateEnd(z);zstreams.delete(p);w32(p+28,0);return r});
 reg('uncompress',c=>{const dest=c.argU32(0),len=c.argU32(1),src=c.argU32(2),size=c.argU32(3),z=new ZStream();z.input=read(src,size);z.next_in=0;z.avail_in=size;z.output=new Uint8Array(u32(len));z.next_out=0;z.avail_out=z.output.length;let r=zinflate.inflateInit(z);if(r!==0)return r;r=zinflate.inflate(z,4);write(dest,z.output.subarray(0,z.next_out));w32(len,z.total_out);zinflate.inflateEnd(z);return r===1?0:r===0?-5:r});
 reg('crc32',c=>c.argU32(1)?pakoCrc32(c.argU32(0),read(c.argU32(1),c.argU32(2)),c.argU32(2),0)>>>0:0);
 const crcTable=rt.alloc(1024,4);for(let i=0;i<256;i++){let c=i;for(let j=0;j<8;j++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;w32(crcTable+i*4,c)}reg('get_crc_table',()=>crcTable);reg('zError',c=>zmessage(zmessages[c.argI32(0)]??'unknown zlib error'));
 return {fs,malloc,free,imports,allocString,errno,files,streams,format:(fmt,c,start=0)=>format(fmt,argReader(c,start)),exportSaves:()=>fs.exportWritable()};
}
