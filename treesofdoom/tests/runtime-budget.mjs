import assert from 'node:assert/strict';
import factory from '../vendor/unicorn_arm.cjs';
import {ArmRuntime} from '../runtime.mjs';
const rt=await ArmRuntime.create({factory,maxMillis:120000});
try {
  const arm=rt.alloc(4000),thumb=rt.alloc(32),loop=rt.alloc(4),invoke=rt.alloc(12);
  rt.writeU32(arm,0xe3a00000);
  for(let i=1;i<=300;i++)rt.writeU32(arm+i*4,0xe2800001);
  rt.writeU32(arm+301*4,0xe12fff1e);
  for(const budget of [8,32,128,2000000])assert.equal(rt.call(arm,[],{batchInstructions:budget}),300);
  rt.writeU16(thumb,0x202a);rt.writeU16(thumb+2,0x4770);
  assert.equal(rt.call(thumb|1,[],{batchInstructions:8}),42);
  rt.writeU32(loop,0xeafffffe);
  assert.throws(()=>rt.call(loop,[],{batchInstructions:256,maxInstructions:512}),/Native call budget exceeded.*counted instructions 768/);
  rt.writeU16(thumb+8,0xe7fe);
  assert.throws(()=>rt.call((thumb+8)|1,[],{batchInstructions:256,maxInstructions:512}),/Native call budget exceeded/);
  assert.equal(rt.call(arm),300);
  [0xe92d4000,0xe12fff33,0xe8bd8000].forEach((v,i)=>rt.writeU32(invoke+i*4,v));
  const nested=rt.registerImport('test:nested',()=>rt.call(arm,[],{batchInstructions:128}));
  assert.equal(rt.call(invoke,[0,0,0,nested]),300);
  const pooled=rt.registerImport('test:pooled',c=>{
    assert.equal(c.argU32(0),123);assert.equal(c.argU32(4),456);
    const lr=c.lr;rt.call(invoke,[0,0,0,nested]);
    assert.equal(c.argU32(0),123);assert.equal(c.argU32(4),456);assert.equal(c.lr,lr);
    return 789;
  });
  // Direct host stubs retain the caller's stack argument layout.
  assert.equal(rt.call(pooled,[123,0,0,0,456]),789);
  const inline=rt.registerImport('test:inline',c=>c.argU32(0)+1,{inline:true});
  assert.equal(rt.call(inline,[41]),42);
  rt.registerImport('test:inline',()=>rt.call(arm)); // replacement clears inline flag
  assert.equal(rt.call(inline),300);
  assert.equal(rt.call(arm,[],{blockBudget:false}),300);
  assert.equal(rt.call(arm),300);
  let a=0,b=0;
  const fresh=rt.alloc(32);
  rt.writeU32(fresh,0xe12fff1e);rt.writeU32(fresh+16,0xe12fff1e);
  const h=rt.engine.hook_add(rt.uc.HOOK_CODE,()=>a++,null,fresh,fresh);
  rt.call(fresh);assert.equal(a,1);rt.engine.hook_del(h);
  const h2=rt.engine.hook_add(rt.uc.HOOK_CODE,()=>b++,null,fresh+16,fresh+16);
  rt.call(fresh+16);assert.equal(a,1);assert.equal(b,1);rt.engine.hook_del(h2);
  console.log('PASS: ARM/Thumb, batch resumption, loop guards, nested calls, context recovery, legacy fallback, callback removal/reuse.');
}finally{rt.dispose();}
