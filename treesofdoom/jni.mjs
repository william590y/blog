// Android JNI host services for the ORIGINAL libnttod.so ARM binary.
// JNI entrypoint order and arguments were inspected from the bundled classes.dex.
// Gameplay and rendering are executed by libnttod.so, never implemented here.
const MERCURY = 'Java_com_venan_mercury_Mercury_';
const GAME = 'Java_com_venan_treesofdoom_TreesOfDoomActivity_';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const f32word = value => new Uint32Array(new Float32Array([value]).buffer)[0];

export function installJNI(runtime, options = {}) {
  const fs = options.fs || new Map();
  const fsHas = path => fs.has ? fs.has(path) : fs.exists(path);
  const fsGet = path => fs.readFile ? fs.readFile(path) : fs.get(path);
  const fsSet = (path,data) => fs.writeFile ? fs.writeFile(path,data) : fs.set(path,data);
  const fsDelete = path => fs.delete ? fs.delete(path) : fs.nodes?.delete(fs.path(path));
  const fsKeys = () => fs.keys ? [...fs.keys()] : [...(fs.nodes?.keys() || [])];
  const log = options.onLog || (() => {});
  const objects = new Map(), classes = new Map(), methods = new Map();
  const methodKeys = new Map(), fields = new Map(), fieldKeys = new Map();
  const keychain = new Map(), registeredNatives = new Map(), directories = new Set(['/','/data','/data/files','/data/files/assets','/data/cache','/data/external']);
  const deferred = [];
  let pendingException = 0, cachedFiles = [];
  const seen = new Set();
  const note = s => { if (!seen.has(s)) { seen.add(s); log(s); } };
  const handle = object => { const h = runtime.alloc(8); objects.set(h, object); return h; };
  const jstring = value => handle({ type: 'string', value: String(value ?? '') });
  const str = h => objects.get(h)?.value ?? '';
  const obj = h => objects.get(h) || {};
  const classHandle = name => {
    if (!classes.has(name)) classes.set(name, handle({ type: 'class', name }));
    return classes.get(name);
  };
  const className = h => obj(h).name || obj(h).className || 'java/lang/Object';
  const jarray = (kind, length, values) => handle({ type: 'array', kind, values: values || Array(length).fill(0), pointer: 0 });
  const utf8 = h => {
    const o = obj(h);
    if (!o.utf8) o.utf8 = runtime.allocCString(str(h));
    return o.utf8;
  };
  const utf16 = h => {
    const o = obj(h);
    if (!o.utf16) {
      const s = str(h), data = new Uint8Array((s.length + 1) * 2), dv = new DataView(data.buffer);
      for (let i = 0; i < s.length; i++) dv.setUint16(i * 2, s.charCodeAt(i), true);
      o.utf16 = runtime.alloc(data.length); runtime.writeBytes(o.utf16, data);
    }
    return o.utf16;
  };
  const methodID = (cls, name, signature, isStatic = false) => {
    const key = `${className(cls)}.${name}${signature}:${isStatic}`;
    if (!methodKeys.has(key)) {
      const id = handle({ type: 'method' });
      methods.set(id, { className: className(cls), name, signature, isStatic });
      methodKeys.set(key, id);
    }
    return methodKeys.get(key);
  };
  const fieldID = (cls, name, signature, isStatic = false) => {
    const key = `${className(cls)}.${name}:${signature}:${isStatic}`;
    if (!fieldKeys.has(key)) {
      const id = handle({ type: 'field' }); fields.set(id, { className: className(cls), name, signature, value: 0 }); fieldKeys.set(key, id);
    }
    return fieldKeys.get(key);
  };
  const parseArgs = signature => signature.slice(1, signature.indexOf(')')).match(/\[*(?:L[^;]*;|[ZBCSIJFD])/g) || [];
  const argsFor = (ctx, signature, mode, first = 3) => {
    let word = first, ptr = mode === 'V' || mode === 'A' ? ctx.argU32(first) : 0;
    const out = [];
    for (const kind of parseArgs(signature)) {
      // C variadic calls promote jfloat to double; jvalue[] retains float32.
      const promotedFloat = kind === 'F' && mode !== 'A';
      const wide = kind === 'J' || kind === 'D' || promotedFloat;
      if (mode === 'V' && wide) ptr = (ptr + 7) & ~7;
      if (!mode && wide) word = (word + 1) & ~1;
      const lo = mode ? runtime.readU32(ptr) : ctx.argU32(word);
      const hi = wide ? (mode ? runtime.readU32(ptr + 4) : ctx.argU32(word + 1)) : 0;
      if (kind === 'J') out.push(Number(BigInt(hi) << 32n | BigInt(lo)));
      else if (kind === 'D' || promotedFloat) { const dv = new DataView(new ArrayBuffer(8)); dv.setUint32(0,lo,true);dv.setUint32(4,hi,true);out.push(dv.getFloat64(0,true)); }
      else if (kind === 'F') out.push(new Float32Array(new Uint32Array([lo]).buffer)[0]);
      else out.push(lo);
      ptr += mode === 'A' ? 8 : wide ? 8 : 4;
      word += wide ? 2 : 1;
    }
    return out;
  };
  const normalize = p => String(p).replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  const fileNames = path => { path = normalize(path); return fsKeys().filter(k => k.startsWith(path + '/')); };
  const readFile = path => fsGet(normalize(path));
  // Persist the original Android SharedPreferences wrapper through the same
  // writable filesystem as the original game's saves.
  const keychainPath='/data/files/mercury-keychain.json';
  const savedKeychain=readFile(keychainPath);
  if(savedKeychain){
    try{
      const record=JSON.parse(decoder.decode(savedKeychain));
      if(record.version===1&&Array.isArray(record.values))for(const [key,value] of record.values)if(typeof key==='string'&&typeof value==='string')keychain.set(key,value);
    }catch(error){log(`Unable to restore Android preferences: ${error.message}`);}
  }
  const saveKeychain=()=>{fsSet(keychainPath,encoder.encode(JSON.stringify({version:1,values:[...keychain]})));fs.flush?.();};

  function invoke(target, method, args) {
    const { className: cn, name, signature } = method;
    const value = obj(target);
    note(`JNI ${cn}.${name}${signature}`);
    if (name === '<init>') { value.className = cn; value.constructorArgs = args; return 0; }
    if (cn === 'java/lang/String') {
      if (name === 'length') return str(target).length;
      if (name === 'toString') return target;
      if (name === 'getBytes') return jarray('B', 0, [...encoder.encode(str(target))]);
    }
    if (cn === 'java/io/File') {
      const path = normalize(str(value.constructorArgs?.[0]));
      if (name === 'mkdir' || name === 'mkdirs') { directories.add(path); fs.directories?.add(path); return 1; }
      if (name === 'exists') return fsHas(path) ? 1 : 0;
      if (name === 'isFile') return readFile(path) ? 1 : 0;
      if (name === 'isDirectory') return directories.has(path) || fs.directories?.has(path) ? 1 : 0;
      if (name === 'length') return readFile(path)?.length || 0;
      if (name === 'getAbsolutePath' || name === 'getPath') return jstring(path);
    }
    if (cn.endsWith('/HGSystemUtil')) {
      const values = { availableProcessors: 1, getBuildVersionSDK: 19, getBuildVersionRelease: '4.4.4', getBuildCPUABI: 'armeabi', getBuildCPUABI2: '', getBuildManufacturer: 'Browser', getBuildModel: 'Local ARM Emulator', getBuildBrand: 'Browser', getBuildDevice: 'web', getBuildProduct: 'treesofdoom', getBuildHardware: 'armeabi', getBuildFingerprint: 'browser/treesofdoom/armeabi', getBuildVersionCodename: 'REL', getLanguageName: 'English', getLocaleCountryCode: 'US', getLocaleLanguageCode: 'en', getLocaleName: 'en_US', getTimeZoneOffsetString: '+0000', getTimeZoneShift: 0, getBuildTime: 0 };
      if (name in values) return typeof values[name] === 'string' ? jstring(values[name]) : values[name];
      if (name === 'getFormattedNumber') return jstring(String(args[0]));
      if (name === 'getFormattedDate') return jstring(new Date(args[0]).toISOString());
      if (name === 'getDayOfWeek') return new Date(args[0]).getUTCDay() + 1;
      if (name.startsWith('getBuild')) return jstring('browser');
      // External links/email are surfaced by the host only when requested.
      if (name === 'openURL') { options.onOpenURL?.(str(args[0])); return 0; }
      if (name === 'sendEmail' || name === 'requestApplicationExit') return 0;
    }
    if (cn.endsWith('/Keychain')) {
      if (name === 'getPasswordForUsername') return jstring(keychain.get(str(args[0])) || '');
      if (name === 'storePasswordForUsername') { keychain.set(str(args[0]), str(args[1])); saveKeychain(); return 0; }
    }
    if (cn.endsWith('/HGAndroidFileSystem')) {
      const path = normalize(str(args[0]));
      if (name === 'isExternalStorageAvailable') return 1;
      if (name === 'doesFileExist') return fsHas(path) ? 1 : 0;
      if (name === 'doesDirectoryExist') return directories.has(path) || fs.directories?.has(path) || fileNames(path).length ? 1 : 0;
      if (name === 'getFileSize') return readFile(path)?.length || 0;
      if (name === 'getFreeSpace' || name === 'getFreeSpaceOfDirectoryContainingFile') return 128 * 1024 * 1024;
      if (name === 'createDirectoryAtPath') { directories.add(path); fs.directories?.add(path); return 1; }
      if (name === 'deleteItemAtPath') { fsDelete(path);directories.delete(path);return 1; }
      if (name === 'moveFile') { const data=readFile(path);if(!data)return 0;fsSet(normalize(str(args[1])),data);fsDelete(path);return 1; }
      if (name === 'listAllFilesSyncCache' || name === 'listAllFilesSync') {
        cachedFiles = fileNames(path); return name.endsWith('Cache') ? cachedFiles.length : jarray('L', 0, cachedFiles.map(jstring));
      }
      if (name === 'getNthCachedResult') return cachedFiles[args[0]] !== undefined ? jstring(cachedFiles[args[0]]) : 0;
      if (name === 'getLengthOfFileInAPK' || name === 'getStartOffsetOfFileInAPK') return 0;
    }
    if (cn.endsWith('/ETUtils') && name === 'getProperty') return 0;
    if (cn.endsWith('/HGJavaHTTPConnection') || cn.endsWith('/HGAndroidHTTPFileDownloader')) {
      if (name === 'start') {
        // Preserve offline failure semantics; do not leave native requests pending.
        const token = value.constructorArgs?.[0] || 0;
        if (cn.endsWith('/HGJavaHTTPConnection')) deferred.push(() => {if(token)native('Java_com_venan_mercury_HGJavaHTTPConnection_handleConnectionComplete', [token >>> 0, Math.floor(token / 2 ** 32), 0, 0, 0]);});
        else deferred.push(()=>{if(token&&!value.cancelled)native('Java_com_venan_mercury_HGAndroidHTTPFileDownloader_handleDownloadComplete',[token>>>0,Math.floor(token/2**32),0,0,jstring('Network unavailable'),0,0xffffffff,0xffffffff]);});
        return 0;
      }
      if(name==='cancelDownload'){value.cancelled=true;return 0;}
      if (name.startsWith('set')) { value[name] = args; return 0; }
      return 0;
    }
    // Optional Android UI, ads, analytics and storefront services do not implement
    // game rules. Their unavailability is represented by null/false responses.
    if (cn.endsWith('/TreesOfDoomActivity') && name === 'hideSplash') { options.onHideSplash?.(); return 0; }
    if (/Flurry|Facebook|W3i|AmazonHelper|IabHelper|PopupTextView/.test(cn)) return 0;
    const ret = signature.slice(signature.indexOf(')') + 1);
    if (ret === 'V') return 0;
    if (ret === 'Ljava/lang/String;') return jstring('');
    if (ret.startsWith('L') || ret.startsWith('[')) return 0;
    return 0;
  }

  const envTable = runtime.alloc(234 * 4), env = runtime.alloc(4);
  runtime.writeU32(env, envTable);
  const vmTable = runtime.alloc(8 * 4), vm = runtime.alloc(4);
  runtime.writeU32(vm, vmTable);
  function bind(index, name, fn) { runtime.writeU32(envTable + index * 4, runtime.registerImport(`JNI.${name}`,fn)); }
  for (let i=4;i<234;i++) bind(i,`unsupported_${i}`, () => { throw new Error(`Unhandled JNIEnv function index ${i}`); });
  bind(4,'GetVersion',()=>0x10006);
  bind(6,'FindClass',c=>classHandle(runtime.readCString(c.argU32(1))));
  bind(10,'GetSuperclass',()=>classHandle('java/lang/Object'));
  bind(11,'IsAssignableFrom',()=>1);
  bind(13,'Throw',c=>{pendingException=c.argU32(1);return 0;});
  bind(14,'ThrowNew',c=>{pendingException=jstring(runtime.readCString(c.argU32(2)));return 0;});
  bind(15,'ExceptionOccurred',()=>pendingException);
  bind(16,'ExceptionDescribe',()=>{log(`JNI exception: ${str(pendingException)}`);return 0;});
  bind(17,'ExceptionClear',()=>{pendingException=0;return 0;});
  bind(18,'FatalError',c=>{throw new Error(runtime.readCString(c.argU32(1)));});
  bind(19,'PushLocalFrame',()=>0);
  bind(20,'PopLocalFrame',c=>c.argU32(1));
  bind(21,'NewGlobalRef',c=>c.argU32(1));
  bind(22,'DeleteGlobalRef',()=>0);bind(23,'DeleteLocalRef',()=>0);
  bind(24,'IsSameObject',c=>Number(c.argU32(1)===c.argU32(2)));
  bind(25,'NewLocalRef',c=>c.argU32(1));bind(26,'EnsureLocalCapacity',()=>0);
  bind(27,'AllocObject',c=>handle({className:className(c.argU32(1))}));
  for (const [offset,mode] of [[28,''],[29,'V'],[30,'A']]) bind(offset,`NewObject${mode}`,c=>{const h=handle({className:className(c.argU32(1))});const m=methods.get(c.argU32(2));if(m)invoke(h,m,argsFor(c,m.signature,mode));return h;});
  bind(31,'GetObjectClass',c=>classHandle(className(c.argU32(1))));bind(32,'IsInstanceOf',()=>1);
  bind(33,'GetMethodID',c=>methodID(c.argU32(1),runtime.readCString(c.argU32(2)),runtime.readCString(c.argU32(3))));
  const returns=['Object','Boolean','Byte','Char','Short','Int','Long','Float','Double','Void'];
  for (const [base,isStatic,nonvirtual] of [[34,false,false],[64,false,true],[114,true,false]]) {
    returns.forEach((kind,k)=>['','V','A'].forEach((mode,j)=>{
      bind(base+k*3+j,`Call${isStatic?'Static':nonvirtual?'Nonvirtual':''}${kind}Method${mode}`,c=>{
        const mid=c.argU32(nonvirtual?3:2),m=methods.get(mid);
        if(!m)throw new Error(`Unknown JNI method 0x${mid.toString(16)}`);
        const out=invoke(c.argU32(1),m,argsFor(c,m.signature,mode,nonvirtual?4:3));
        if(kind==='Long')return {u64:BigInt(Math.trunc(out||0))};
        if(kind==='Float')return {f32:out||0};if(kind==='Double')return {f64:out||0};return out||0;
      });
    }));
  }
  bind(94,'GetFieldID',c=>fieldID(c.argU32(1),runtime.readCString(c.argU32(2)),runtime.readCString(c.argU32(3))));
  bind(113,'GetStaticMethodID',c=>methodID(c.argU32(1),runtime.readCString(c.argU32(2)),runtime.readCString(c.argU32(3)),true));
  bind(144,'GetStaticFieldID',c=>fieldID(c.argU32(1),runtime.readCString(c.argU32(2)),runtime.readCString(c.argU32(3)),true));
  for(let k=0;k<9;k++){
    for(const b of [95,145])bind(b+k,`GetField_${b+k}`,c=>fields.get(c.argU32(2))?.value||0);
    for(const b of [104,154])bind(b+k,`SetField_${b+k}`,c=>{const f=fields.get(c.argU32(2));if(f)f.value=c.argU32(3);return 0;});
  }
  bind(163,'NewString',c=>{const data=runtime.readBytes(c.argU32(1),c.argU32(2)*2);return jstring(new TextDecoder('utf-16le').decode(data));});
  bind(164,'GetStringLength',c=>str(c.argU32(1)).length);
  bind(165,'GetStringChars',c=>{if(c.argU32(2))runtime.writeBytes(c.argU32(2),new Uint8Array([0]));return utf16(c.argU32(1));});
  bind(166,'ReleaseStringChars',()=>0);
  bind(167,'NewStringUTF',c=>jstring(runtime.readCString(c.argU32(1))));
  bind(168,'GetStringUTFLength',c=>encoder.encode(str(c.argU32(1))).length);
  bind(169,'GetStringUTFChars',c=>{if(c.argU32(2))runtime.writeBytes(c.argU32(2),new Uint8Array([0]));return utf8(c.argU32(1));});
  bind(170,'ReleaseStringUTFChars',()=>0);
  bind(171,'GetArrayLength',c=>obj(c.argU32(1)).values?.length||0);
  bind(172,'NewObjectArray',c=>jarray('L',c.argU32(1),Array(c.argU32(1)).fill(c.argU32(3))));
  bind(173,'GetObjectArrayElement',c=>obj(c.argU32(1)).values?.[c.argU32(2)]||0);
  bind(174,'SetObjectArrayElement',c=>{obj(c.argU32(1)).values[c.argU32(2)]=c.argU32(3);return 0;});
  const kinds=['Z','B','C','S','I','J','F','D'],sizes=[1,1,2,2,4,8,4,8];
  kinds.forEach((kind,k)=>{
    const bytes= h=>{const a=obj(h),size=sizes[k];if(!a.pointer){a.pointer=runtime.alloc(Math.max(4,a.values.length*size));a.values.forEach((v,i)=>{if(size===1)runtime.writeBytes(a.pointer+i,new Uint8Array([v]));else if(size===2)runtime.writeBytes(a.pointer+i*2,new Uint8Array([v&255,v>>>8]));else runtime.writeU32(a.pointer+i*size,v);});}return a.pointer;};
    bind(175+k,`New${kind}Array`,c=>jarray(kind,c.argU32(1)));
    bind(183+k,`Get${kind}ArrayElements`,c=>bytes(c.argU32(1)));
    bind(191+k,`Release${kind}ArrayElements`,()=>0);
    bind(199+k,`Get${kind}ArrayRegion`,c=>{runtime.writeBytes(c.argU32(4),runtime.readBytes(bytes(c.argU32(1))+c.argU32(2)*sizes[k],c.argU32(3)*sizes[k]));return 0;});
    bind(207+k,`Set${kind}ArrayRegion`,c=>{runtime.writeBytes(bytes(c.argU32(1))+c.argU32(2)*sizes[k],runtime.readBytes(c.argU32(4),c.argU32(3)*sizes[k]));return 0;});
  });
  bind(215,'RegisterNatives',c=>{const table=c.argU32(2);for(let i=0;i<c.argU32(3);i++){const p=table+i*12;registeredNatives.set(runtime.readCString(runtime.readU32(p)),{signature:runtime.readCString(runtime.readU32(p+4)),address:runtime.readU32(p+8)});}return 0;});
  bind(216,'UnregisterNatives',()=>0);bind(217,'MonitorEnter',()=>0);bind(218,'MonitorExit',()=>0);
  bind(219,'GetJavaVM',c=>{runtime.writeU32(c.argU32(1),vm);return 0;});
  bind(220,'GetStringRegion',c=>{const s=str(c.argU32(1)).slice(c.argU32(2),c.argU32(2)+c.argU32(3)),a=new Uint8Array(s.length*2),d=new DataView(a.buffer);for(let i=0;i<s.length;i++)d.setUint16(i*2,s.charCodeAt(i),true);runtime.writeBytes(c.argU32(4),a);return 0;});
  bind(221,'GetStringUTFRegion',c=>{runtime.writeBytes(c.argU32(4),encoder.encode(str(c.argU32(1)).slice(c.argU32(2),c.argU32(2)+c.argU32(3))));return 0;});
  bind(224,'GetStringCritical',c=>utf16(c.argU32(1)));bind(225,'ReleaseStringCritical',()=>0);
  bind(226,'NewWeakGlobalRef',c=>c.argU32(1));bind(227,'DeleteWeakGlobalRef',()=>0);bind(228,'ExceptionCheck',()=>Number(!!pendingException));bind(232,'GetObjectRefType',()=>1);
  for(let i=3;i<8;i++)runtime.writeU32(vmTable+i*4,runtime.registerImport(`JavaVM.${i}`,c=>{if([4,6,7].includes(i))runtime.writeU32(c.argU32(1),env);return 0;}));
  const activity=handle({className:'com/venan/treesofdoom/TreesOfDoomActivity'});
  const mercuryClass=classHandle('com/venan/mercury/Mercury');
  const gameClass=classHandle('com/venan/treesofdoom/TreesOfDoomActivity');
  const native=(name,args=[])=>runtime.callSymbol(name,[env,name.startsWith(GAME)?gameClass:mercuryClass,...args]);
  function initializeUnusedTouchSlots(){
    // Original setMaxHeldInputs() leaves slot pointer IDs at +4 uninitialized,
    // although its free-slot search requires -1 there. Complete the original
    // reset only when all internal IDs show there are no active gestures.
    const singleton=runtime.symbols.get('_ZN7mercury21HGAndroidTouchManager11s_pInstanceE');
    if(!singleton)return;
    const manager=runtime.readU32(singleton);
    if(!manager||runtime.readU32(manager+4)!==0)return;
    const count=runtime.readU32(manager+8),slots=runtime.readU32(manager+0x20);
    if(!slots||count===0||count>32)return;
    let uninitialized=false;
    for(let i=0;i<count;i++){
      const slot=slots+i*0x30;
      if(runtime.readU32(slot)!==0xffffffff)return;
      if(runtime.readU32(slot+4)!==0xffffffff)uninitialized=true;
    }
    if(uninitialized){note('Initializing unused Android touch slots with the original reset routine.');runtime.callSymbol('_ZN7mercury21HGAndroidTouchManager14cancelAllInputEv',[manager]);}
  }
  return {
    env,vm,activity,objects,methods,registeredNatives,jstring,native,
    startup({width=320,height=480,assetsRoot='/data/files/assets',filesDir='/data/files',cacheDir='/data/cache',apkPath='/game.apk',externalFilesDir='/data/external'}={}){
      runtime.callSymbol('JNI_OnLoad',[vm,0]);
      native(MERCURY+'startup',[activity,...['2.5.0','250',assetsRoot,filesDir,cacheDir,apkPath,externalFilesDir,'0123456789abcdef','000000000000'].map(jstring),width,height,1]);
      native(GAME+'selectResolution');
      native(MERCURY+'initWindow');
      native(GAME+'startup');
      native(MERCURY+'initGLES20');
      native(MERCURY+'setDisplaySize',[width,height]);
      // Original onStart joins initialization, enters the foreground, then
      // constructs the native W3i bridge even when its ad service is offline.
      native(MERCURY+'appEnteringForeground');
      const w3iClass=classHandle('com/venan/treesofdoom/W3iAndroidManager');
      const w3iObject=handle({className:'com/venan/treesofdoom/W3iAndroidManager'});
      runtime.callSymbol('Java_com_venan_treesofdoom_W3iAndroidManager_startUpNative',[env,w3iClass,w3iObject]);
      native(MERCURY+'appResumed');
    },
    update(){for(let i=0,n=deferred.length;i<n;i++)deferred.shift()();native(MERCURY+'update');},
    resize(width,height){native(MERCURY+'setDisplaySize',[width,height]);},
    touch(action,x,y,pointer=0){initializeUnusedTouchSlots();native(MERCURY+'processTouchEvent',[action,f32word(x),f32word(y),pointer]);},
    pause(){native(MERCURY+'appSuspended');native(MERCURY+'appEnteredBackground');},
    resume(){native(MERCURY+'appEnteringForeground');native(MERCURY+'appResumed');},
  };
}
