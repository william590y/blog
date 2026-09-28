// ARM32 ELF execution for the original, unmodified Android native library.
// Unicorn.js 2.1.4 (GPL-2.0) provides instruction emulation; Android APIs are HLE.
const PAGE = 4096;
const align = (n, a=PAGE) => Math.ceil(n/a)*a;
const hex = n => '0x' + (n>>>0).toString(16);
const decoder = new TextDecoder();
const encoder = new TextEncoder();
// Only host implementations which never call guest code may run inside a hook.
// qsort, finalizers, JNI and FMOD keep the reentrant stop/resume path.
const FAST_IMPORTS = new Set(`malloc calloc realloc free memcpy memmove memset memcmp memchr
  __aeabi_memcpy __aeabi_memcpy4 __aeabi_memcpy8 __aeabi_memmove __aeabi_memmove4
  __aeabi_memset __aeabi_memset4 __aeabi_memset8 __aeabi_memclr __aeabi_memclr4 __aeabi_memclr8
  strlen strcmp strncmp strcasecmp strncasecmp strcpy strncpy strdup strcat strchr strrchr strstr
  wcslen wcsncmp atoi atoll strtol strtoul strtod __errno
  sqrt sqrtf cos cosf sin sinf tan tanf asin asinf acos acosf atan atanf floor floorf ceil ceilf
  round roundf log logf exp expf fabs fabsf fmod fmodf pow powf atan2 atan2f modf modff frexp isnan
  srand48 lrand48 time gettimeofday clock_gettime getrusage gmtime localtime mktime
  pthread_mutexattr_init pthread_mutexattr_settype pthread_mutexattr_destroy pthread_mutex_init
  pthread_mutex_lock pthread_mutex_trylock pthread_mutex_unlock pthread_mutex_destroy
  pthread_key_create pthread_key_delete pthread_getspecific pthread_setspecific
  pthread_cond_init pthread_cond_destroy pthread_cond_signal pthread_cond_broadcast
  crc32 get_crc_table inflateInit_ inflateInit2_ inflate inflateReset inflateEnd
  deflateInit2_ deflate deflateReset deflateEnd uncompress zError`.split(/\s+/).filter(Boolean));
const FLOAT_HELPERS = ['i2f','f2iz','fcmple','fcmpun','fadd','fsub','fmul','fcmplt','fcmpgt','fcmpeq','fcmpge','fdiv','ui2f','f2uiz'];

export class ArmRuntime {
  static async create(options={}) {
    let factory = options.factory || globalThis.MUnicorn;
    if (!factory && typeof process !== 'undefined') {
      const mod = await import('./vendor/unicorn_arm.cjs');
      factory = mod.default;
    }
    if (!factory) throw new Error('Load vendor/unicorn_arm.js before the runtime.');
    return new ArmRuntime(await factory(), options);
  }
  constructor(uc, options={}) {
    this.uc = uc;
    this.engine = new uc.Unicorn(uc.ARCH_ARM, uc.MODE_ARM);
    this.handle = uc.getValue(this.engine.handle_ptr, '*');
    this.options = options;
    this.regs = Array.from({length:13}, (_,i)=>uc['ARM_REG_R'+i]);
    this.regs.push(uc.ARM_REG_SP, uc.ARM_REG_LR, uc.ARM_REG_PC);
    this.regScratch = uc._malloc(16);
    this.regScratchView = () => {
      if(this._regScratchView?.buffer!==uc.HEAPU8.buffer)this._regScratchView=new DataView(uc.HEAPU8.buffer,this.regScratch,16);
      return this._regScratchView;
    };
    this.regions = [];
    this.symbols = new Map(); this.imports = new Map(); this.dataSymbols = new Map();
    this.stubNames = new Map(); this.stubNext = 0x0e000000;
    this.returnAddress = 0x0e0ff000;
    this.heapStart = 0x10000000; this.heapNext=this.heapStart;
    this.heapSize = options.heapSize || 128*1024*1024;
    this.stackStart = 0x70000000; this.stackSize=8*1024*1024;
    this.map(this.stubNext, 0x100000, 'host callbacks');
    this.map(this.heapStart, this.heapSize, 'heap');
    this.map(this.stackStart, this.stackSize, 'stack');
    this.writeU32(this.returnAddress, 0xe12fff1e);
    this.setReg(13,this.stackStart+this.stackSize-0x1000);
    this.engine.reg_write_i32(uc.ARM_REG_C1_C0_2, 0xf00000);
    this.engine.reg_write_i32(uc.ARM_REG_FPEXC, 0x40000000);
    this.depth=0; this.images=[]; this.lastImports=[]; this.stats={calls:0,imports:0,fastImports:0,batches:0};
    this.softFloatHooks=new Map();
    this.engine.hook_add(uc.HOOK_CODE, (e,address) => {
      const stub=this.stubNames.get(Number(address));
      if(this.options.fastImports!==false && stub?.fn && FAST_IMPORTS.has(stub.name)){
        try{
          this.inInlineImport=true;
          const ctx=this.context(stub.name,stub.address);
          this.recordImport(stub.name);this.stats.fastImports++;
          const result=stub.fn(ctx);
          if(result?.then)throw new Error('Native import returned a Promise: '+stub.name);
          this.setResult(result);
          // The real ARM bx-lr instruction in this stub performs the return.
        }catch(error){this.pendingError=error;e.emu_stop();}
        finally{this.inInlineImport=false;}
        return;
      }
      this.pendingTrap=Number(address); e.emu_stop();
    }, null, 0x0e000000,0x0e0fffff);
    this.engine.hook_add(uc.HOOK_MEM_INVALID, (e,type,address,size,value)=>{
      this.memoryFault={type,address:Number(address),size,value:String(value),pc:this.getReg(15)};
      return false;
    });
  }
  map(address,size,label='') {
    address=address>>>0; size=align(size);
    const ptr=this.uc._malloc(size);
    if(!ptr) throw new Error('Host allocation failed: '+size);
    this.uc.HEAPU8.fill(0,ptr,ptr+size);
    const err=this.uc._uc_mem_map_ptr(this.handle, BigInt(address), BigInt(size),this.uc.PROT_ALL,ptr);
    if(err) throw new Error('Map failed '+hex(address)+': '+this.uc.strerror(err));
    const region={address,size,ptr,label}; this.regions.push(region); return region;
  }
  region(address,size=1) {
    address=address>>>0;
    const r=this.regions.find(r=>address>=r.address && address+size<=r.address+r.size);
    if(!r) throw new Error('Guest memory access outside mapped regions: '+hex(address)+' ('+size+' bytes)');
    return r;
  }
  view(address,size) {
    const r=this.region(address,size);
    return new Uint8Array(this.uc.HEAPU8.buffer,r.ptr+(address>>>0)-r.address,size);
  }
  readBytes(address,size) { return this.view(address,size).slice(); }
  writeBytes(address,data) { this.view(address,data.byteLength ?? data.length).set(data); }
  readU8(address) { return this.view(address,1)[0]; }
  writeU8(address,value) { this.view(address,1)[0]=value; }
  readU16(address) { const a=this.view(address,2); return a[0]|a[1]<<8; }
  writeU16(address,value) { const a=this.view(address,2); a[0]=value;a[1]=value>>>8; }
  readU32(address) { const a=this.view(address,4); return (a[0]|a[1]<<8|a[2]<<16|a[3]<<24)>>>0; }
  writeU32(address,value) { const a=this.view(address,4);a[0]=value;a[1]=value>>>8;a[2]=value>>>16;a[3]=value>>>24; }
  readI32(address) { return this.readU32(address)|0; }
  writeI32(address,value) {this.writeU32(address,value);}
  dataView(address,size) {const a=this.view(address,size);return new DataView(a.buffer,a.byteOffset,size);}
  readF32(address) {return this.dataView(address,4).getFloat32(0,true);}
  writeF32(address,value) {this.dataView(address,4).setFloat32(0,value,true);}
  readF64(address) {return this.dataView(address,8).getFloat64(0,true);}
  writeF64(address,value) {this.dataView(address,8).setFloat64(0,value,true);}
  readCString(address,max=1<<20) {
    if(!address)return '';
    const r=this.region(address);const bytes=this.view(address,Math.min(max,r.address+r.size-address));
    const end=bytes.indexOf(0);return decoder.decode(end<0?bytes:bytes.subarray(0,end));
  }
  writeCString(address,value) {const bytes=encoder.encode(value);this.writeBytes(address,bytes);this.writeU8(address+bytes.length,0);return bytes.length;}
  alloc(size,alignment=8) {
    const address=align(this.heapNext,alignment); const end=address+Math.max(size,1);
    if(end>this.heapStart+this.heapSize)throw new Error('Guest heap exhausted');
    this.heapNext=end; this.view(address,Math.max(size,1)).fill(0);return address;
  }
  allocCString(s) {const b=encoder.encode(s);const p=this.alloc(b.length+1);this.writeBytes(p,b);return p;}
  getReg(i) {const err=this.uc._uc_reg_read(this.handle,this.regs[i],this.regScratch);if(err)throw new Error('reg read '+err);return this.regScratchView().getUint32(0,true);}
  setReg(i,v) {this.regScratchView().setUint32(0,Number(v)>>>0,true);const err=this.uc._uc_reg_write(this.handle,this.regs[i],this.regScratch);if(err)throw new Error('reg write '+err);}
  registerImport(name, fn) {
    let item=this.imports.get(name);
    if(!item){const address=this.stubNext;this.stubNext+=4;if(this.stubNext>=this.returnAddress)throw new Error('Host callback space exhausted');this.writeU32(address,0xe12fff1e);item={name,address,fn};this.imports.set(name,item);this.stubNames.set(address,item);}
    else if(fn)item.fn=fn;
    return item.address;
  }
  registerDataSymbol(name,address) {this.dataSymbols.set(name,address);return address;}
  describeAddress(address) {
    let bestName='',bestAddress=0;
    for(const [name,value]of this.symbols)if(value<=address&&value>=bestAddress){bestName=name;bestAddress=value;}
    return hex(address)+(bestName?' ('+bestName+' + '+hex(address-bestAddress)+')':'');
  }
  loadElf(bytes,{base=0x01000000}={}) {
    if(!(bytes instanceof Uint8Array))bytes=new Uint8Array(bytes);
    const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u16=i=>dv.getUint16(i,true),u32=i=>dv.getUint32(i,true);
    if(u32(0)!==0x464c457f||bytes[4]!==1||bytes[5]!==1||u16(18)!==40)throw new Error('Expected little-endian ELF32 ARM library');
    const phoff=u32(28),phsize=u16(42),phnum=u16(44); const segments=[];
    for(let i=0;i<phnum;i++){const p=phoff+i*phsize;if(u32(p)===1)segments.push({offset:u32(p+4),va:u32(p+8),fileSize:u32(p+16),memSize:u32(p+20)});}
    const size=align(Math.max(...segments.map(s=>s.va+s.memSize)));this.map(base,size,'ELF image');
    for(const s of segments)this.writeBytes(base+s.va,bytes.subarray(s.offset,s.offset+s.fileSize));
    const shoff=u32(32),shsize=u16(46),shnum=u16(48),sections=[];
    for(let i=0;i<shnum;i++){const p=shoff+i*shsize;sections.push({nameOffset:u32(p),type:u32(p+4),address:u32(p+12),offset:u32(p+16),size:u32(p+20),link:u32(p+24),entsize:u32(p+36)});}
    const cstr=(off)=>{let end=off;while(bytes[end]!==0&&end<bytes.length)end++;return decoder.decode(bytes.subarray(off,end));};
    const names=sections[u16(50)];for(const s of sections)s.name=cstr(names.offset+s.nameOffset);
    const symbols=[];
    const symsec=sections.find(s=>s.type===11);if(!symsec)throw new Error('Missing dynamic symbol table');
    const strsec=sections[symsec.link];
    for(let off=symsec.offset;off<symsec.offset+symsec.size;off+=symsec.entsize){
      const sym={name:cstr(strsec.offset+u32(off)),value:u32(off+4),size:u32(off+8),info:bytes[off+12],section:u16(off+14)};symbols.push(sym);
      if(sym.section&&sym.name)this.symbols.set(sym.name,base+sym.value);
    }
    const relocations=[];
    for(const s of sections.filter(s=>s.type===9))for(let off=s.offset;off<s.offset+s.size;off+=s.entsize||8){const info=u32(off+4),address=base+u32(off);relocations.push({address,type:info&255,sym:symbols[info>>>8],addend:this.readU32(address)});}
    const image={base,size,symbols,relocations,constructors:[],sections};this.images.push(image);this.resolveImports();
    const init=sections.find(s=>s.name==='.init_array');if(init)for(let off=0;off<init.size;off+=4){const addr=this.readU32(base+init.address+off);if(addr&&addr!==0xffffffff)image.constructors.push(addr);}
    if(this.options.accelerateFloat===true)this.installSoftFloatAccelerators();
    return image;
  }
  installSoftFloatAccelerators() {
    if(typeof this.uc._nttod_add_f32_hook!=='function')return 0;
    for(let index=0;index<FLOAT_HELPERS.length;index++){
      const name='__aeabi_'+FLOAT_HELPERS[index],address=this.symbols.get(name);
      if(address===undefined||this.softFloatHooks.has(address))continue;
      const error=this.uc._nttod_add_f32_hook(this.handle,address,index+1);
      if(error)throw new Error('Soft-float hook failed for '+name+': '+this.uc.strerror(error));
      this.softFloatHooks.set(address,name);
    }
    return this.softFloatHooks.size;
  }
  softFloatStats(){return {hooks:this.softFloatHooks.size,handled:this.uc._nttod_hook_count?.(this.handle)??0,fallback:this.uc._nttod_fallback_count?.(this.handle)??0};}
  resolveImports() {
    for(const image of this.images)for(const rel of image.relocations){
      let S=0;const sym=rel.sym;
      if(sym?.name){
        if(sym.section)S=image.base+sym.value;
        else if(this.dataSymbols.has(sym.name))S=this.dataSymbols.get(sym.name);
        else if(this.symbols.has(sym.name))S=this.symbols.get(sym.name);
        else S=this.registerImport(sym.name);
      }
      let value;
      switch(rel.type){case 0:continue;case 2:value=S+rel.addend;break;case 3:value=S+rel.addend-rel.address;break;case 21:case 22:value=S;break;case 23:value=image.base+rel.addend;break;default:throw new Error('Unsupported ARM relocation '+rel.type+' at '+hex(rel.address));}
      this.writeU32(rel.address,value);
    }
  }
  context(name,address) {
    const rt=this,regs=[];let sp,lr,temp;
    const floatBits=()=>temp||(temp=new DataView(new ArrayBuffer(8)));
    const ctx={runtime:rt,name,address,get sp(){return sp??(sp=rt.getReg(13));},get lr(){return lr??(lr=rt.getReg(14));},argU32(i){return i<4?(regs[i]??(regs[i]=rt.getReg(i))):rt.readU32(this.sp+(i-4)*4);},argI32(i){return this.argU32(i)|0;},argF32(i){const t=floatBits();t.setUint32(0,this.argU32(i),true);return t.getFloat32(0,true);},argF64(i){const t=floatBits();t.setUint32(0,this.argU32(i),true);t.setUint32(4,this.argU32(i+1),true);return t.getFloat64(0,true);}};
    return ctx;
  }
  setResult(result) {
    if(result&&typeof result==='object'){
      const tmp=new DataView(new ArrayBuffer(8));
      if('f32'in result){tmp.setFloat32(0,result.f32,true);this.setReg(0,tmp.getUint32(0,true));}
      else if('f64'in result){tmp.setFloat64(0,result.f64,true);this.setReg(0,tmp.getUint32(0,true));this.setReg(1,tmp.getUint32(4,true));}
      else if('u64'in result){const n=BigInt(result.u64);this.setReg(0,Number(n&0xffffffffn));this.setReg(1,Number(n>>32n&0xffffffffn));}
      else throw new Error('Unsupported import result '+JSON.stringify(result));
    }else this.setReg(0,result??0);
  }
  recordImport(name){this.stats.imports++;this.lastImports.push(name);if(this.lastImports.length>40)this.lastImports.shift();}
  callSymbol(name,args=[],options={}) {const address=this.symbols.get(name);if(address===undefined)throw new Error('Missing native symbol: '+name);return this.call(address,args,{...options,name});}
  call(address,args=[],options={}) {
    if(this.inInlineImport)throw new Error('Reentrant guest call from an inline import; use the slow path for this handler.');
    options={...this.options,...options};
    const saved=this.engine.context_alloc();this.engine.context_save(saved);const savedTrap=this.pendingTrap;let steps=0;
    const beginTime=performance.now();this.depth++;this.stats.calls++;this.pendingTrap=undefined;
    try {
      const oldSp=this.getReg(13);const sp=(oldSp-0x1000)&~7;
      this.setReg(13,sp);for(let i=0;i<Math.max(args.length,4);i++){const v=args[i]??0;if(i<4)this.setReg(i,v);else this.writeU32(sp+(i-4)*4,v);}
      this.setReg(14,this.returnAddress);let next=address;
      while(true){
        this.pendingTrap=undefined;this.pendingError=undefined;
        this.engine.emu_start(next,this.returnAddress,0,options.batchInstructions||2_000_000);this.stats.batches++;
        if(this.pendingError)throw this.pendingError;
        const pc=this.getReg(15);if(pc===this.returnAddress)break;
        if(this.pendingTrap!==undefined){
          const stub=this.stubNames.get(this.pendingTrap);if(!stub)throw new Error('Unknown host callback '+hex(this.pendingTrap));
          const ctx=this.context(stub.name,stub.address);this.recordImport(stub.name);
          if(!stub.fn)throw new Error('Unimplemented Android import: '+stub.name+' (caller '+hex(ctx.lr)+')');
          const result=stub.fn(ctx);if(result?.then)throw new Error('Native import returned a Promise: '+stub.name);
          this.setResult(result);next=ctx.lr;
        }else{steps+=(options.batchInstructions||2_000_000);next=pc|((this.engine.reg_read_i32(this.uc.ARM_REG_CPSR)&32)?1:0);}
        const elapsedMs=performance.now()-beginTime;
        if(steps>(options.maxInstructions||100_000_000)||elapsedMs>(options.maxMillis||30_000))throw new Error('Native call budget exceeded at '+hex(this.getReg(15))+' (elapsed '+Math.round(elapsedMs)+' ms; counted instructions '+steps+')');
      }
      const result=this.getReg(0);this.lastResult={r0:result,r1:this.getReg(1),elapsedMs:performance.now()-beginTime};return result;
    } catch(error){
      this.lastCpuState=Array.from({length:16},(_,i)=>this.getReg(i));
      const message=String(error.message||error);throw new Error(message+'\nNative call '+(options.name||this.describeAddress(address))+', PC='+this.describeAddress(this.getReg(15))+', LR='+this.describeAddress(this.getReg(14))+(this.memoryFault?'\nMemory fault '+JSON.stringify(this.memoryFault):'')+'\nRecent imports: '+this.lastImports.join(', '));
    } finally {this.depth--;this.engine.context_restore(saved);this.engine.context_free(saved);this.pendingTrap=savedTrap;}
  }
  constructors(options={}) {for(const image of this.images)for(const address of image.constructors)this.call(address,[],options);}
  dispose(){this.uc._nttod_clear_f32_hooks?.(this.handle);this.engine.close();for(const r of this.regions)this.uc._free(r.ptr);this.uc._free(this.regScratch);}
}
