// IndexedDB is the primary store. A small synchronous recovery snapshot also
// survives iOS suspending the page before its final transaction can finish.
const NAME='trees-of-doom-saves', STORE='files', META='metadata';
const BACKUP='trees-of-doom-recovery-v1';
let queue=Promise.resolve(), lastStamp=0;
function database(){return new Promise((resolve,reject)=>{
  const request=indexedDB.open(NAME,2);let blocked=false;
  request.onupgradeneeded=()=>{for(const name of [STORE,META])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name);};
  request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();if(blocked)db.close();else resolve(db);};
  request.onerror=()=>reject(request.error);
  request.onblocked=()=>{blocked=true;reject(new Error('Close other Trees of Doom tabs to update saved progress.'));};
});}
function encode(files,savedAt){return JSON.stringify({version:1,savedAt,files:[...files].map(([path,bytes])=>{
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return [path,btoa(binary)];
})});}
function recovery(){try{
  const snapshot=JSON.parse(localStorage.getItem(BACKUP));
  if(snapshot?.version!==1||!Number.isFinite(snapshot.savedAt)||!Array.isArray(snapshot.files))return null;
  return {savedAt:snapshot.savedAt,files:new Map(snapshot.files.map(([path,base64])=>{
    if(typeof path!=='string'||typeof base64!=='string')throw Error('Invalid recovery file');
    return [path,Uint8Array.from(atob(base64),c=>c.charCodeAt(0))];
  }))};
}catch{return null;}}
export async function readSaves(){
  const backup=recovery();
  try{
    const db=await database();
    try{return await new Promise((resolve,reject)=>{
      const tx=db.transaction([STORE,META],'readonly'),files=new Map();let savedAt=0;
      const request=tx.objectStore(STORE).openCursor();
      request.onsuccess=()=>{const c=request.result;if(c){files.set(c.key,new Uint8Array(c.value));c.continue();}};
      const stamp=tx.objectStore(META).get('savedAt');stamp.onsuccess=()=>{savedAt=stamp.result||0;};
      tx.oncomplete=()=>{lastStamp=Math.max(lastStamp,savedAt,backup?.savedAt||0);resolve(backup&&backup.savedAt>savedAt?backup.files:files);};
      tx.onerror=tx.onabort=()=>reject(tx.error||new Error('Reading saved progress was interrupted'));
    });}finally{db.close();}
  }catch(error){if(backup){lastStamp=Math.max(lastStamp,backup.savedAt);return backup.files;}throw error;}
}
export function writeSaves(files){
  const savedAt=lastStamp=Math.max(Date.now(),lastStamp+1);
  let recovered=false;
  try{
    // Keep this below the typical localStorage quota; IndexedDB accepts larger saves.
    if([...files.values()].reduce((size,bytes)=>size+bytes.length,0)>2*1024*1024)throw Error('Recovery snapshot too large');
    localStorage.setItem(BACKUP,encode(files,savedAt));recovered=true;
  }catch{/* IndexedDB remains available when localStorage is full or disabled. */}
  const write=queue.catch(()=>{}).then(async()=>{
    const db=await database();
    try{await new Promise((resolve,reject)=>{
      const tx=db.transaction([STORE,META],'readwrite'),store=tx.objectStore(STORE);
      store.clear();for(const [path,bytes]of files)store.put(bytes.slice().buffer,path);
      tx.objectStore(META).put(savedAt,'savedAt');
      tx.oncomplete=resolve;
      tx.onerror=tx.onabort=()=>reject(tx.error||new Error('Saving progress was interrupted'));
    });}finally{db.close();}
  });
  queue=write;
  return write.then(()=>({backupOnly:false}),error=>{if(recovered)return {backupOnly:true};throw error;});
}
export async function requestPersistentStorage(){
  try{return await navigator.storage?.persist?.()||false;}catch{return false;}
}
