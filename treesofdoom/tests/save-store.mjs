// Run with fake-indexeddb available (e.g. NODE_PATH=/path/to/node_modules).
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {MemoryFS} from '../libc.mjs';
const {IDBFactory}=createRequire(import.meta.url)('fake-indexeddb');
globalThis.indexedDB=new IDBFactory();
const local=new Map();
globalThis.localStorage={getItem:key=>local.get(key)??null,setItem:(key,value)=>local.set(key,value)};
const path='/data/files/player.db';
const files=value=>new Map([[path,new Uint8Array(value)]]);
// Existing v1 saves must migrate without loss.
await new Promise((resolve,reject)=>{
  const request=indexedDB.open('trees-of-doom-saves',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('files').put(new Uint8Array([1,2,255]).buffer,path);
  request.onsuccess=()=>{request.result.close();resolve();};request.onerror=()=>reject(request.error);
});
let store=await import('../save-store.mjs');
assert.deepEqual(await store.readSaves(),files([1,2,255]));
await store.writeSaves(files([3,0,255]));
store=await import('../save-store.mjs?reload');
assert.deepEqual(await store.readSaves(),files([3,0,255]));
const older=store.writeSaves(files([4])),newer=store.writeSaves(files([5]));
await Promise.all([older,newer]);assert.deepEqual(await store.readSaves(),files([5]));
const db=indexedDB;globalThis.indexedDB={open(){throw Error('Database unavailable');}};
const pending=store.writeSaves(files([6]));
assert.deepEqual(await store.readSaves(),files([6])); // recovery is synchronous
assert.equal((await pending).backupOnly,true);
globalThis.indexedDB=db;
assert.deepEqual(await store.readSaves(),files([6])); // newer recovery wins over old DB
const set=localStorage.setItem;localStorage.setItem=()=>{throw Error('Storage quota');};
await store.writeSaves(files([7]));assert.deepEqual(await store.readSaves(),files([7]));
globalThis.indexedDB={open(){throw Error('Database unavailable');}};
await assert.rejects(store.writeSaves(files([8])),/Database unavailable/);
globalThis.indexedDB=db;localStorage.setItem=set;
await store.writeSaves(new Map());assert.equal((await store.readSaves()).size,0); // deleted saves stay deleted
let resolve,reject,attempts=0;
const fs=new MemoryFS(new Map(),()=>{attempts++;return new Promise((a,b)=>{resolve=a;reject=b;});});
fs.writeFile(path,[10]);const failed=fs.flush();fs.flush();assert.equal(attempts,1);
reject(Error('Disk full'));await failed;assert.equal(fs.savedRevision,0);
fs.retryAfter=0;const retry=fs.flush();resolve();await retry;assert.equal(fs.savedRevision,fs.revision);
fs.writeFile(path,[11]);const first=fs.flush(),resolveFirst=resolve;
fs.writeFile(path,[12]);const second=fs.flush(),resolveSecond=resolve;
resolveFirst();await first;assert.notEqual(fs.savedRevision,fs.revision);
resolveSecond();await second;assert.equal(fs.savedRevision,fs.revision);
console.log('PASS: legacy migration, binary reload, ordered saves, synchronous recovery, storage failures, deletions, dirty-revision retries.');
