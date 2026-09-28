import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {ArmRuntime} from '../runtime.mjs';
import factory from '../vendor/unicorn_arm.cjs';
import {installLibc} from '../libc.mjs';
import {installJNI} from '../jni.mjs';
import {installGLES} from '../gles.mjs';
import {installAudio} from '../audio.mjs';
const require=createRequire(import.meta.url);
const gl=require('gl')(320,480,{alpha:false,antialias:false,depth:true,stencil:true,preserveDrawingBuffer:true});
const {PNG}=require('pngjs');
if(!gl)throw Error('No real GL context');
console.log('GL',gl.getParameter(gl.VERSION),gl.getParameter(gl.RENDERER));
const rt=await ArmRuntime.create({factory,maxMillis:120000});
const files=new Map();
for(const item of JSON.parse(await readFile(new URL('../game/manifest.json',import.meta.url),'utf8')))files.set(item.path,new Uint8Array(await readFile(new URL('../game/'+item.url,import.meta.url))));
const libc=installLibc(rt,{fs:files,onLog:()=>{}});let guestNow=1700000000000;
rt.registerImport('time',c=>{const s=Math.floor(guestNow/1000);if(c.argU32(0))rt.writeU32(c.argU32(0),s);return s;});
rt.registerImport('gettimeofday',c=>{const p=c.argU32(0);if(p){rt.writeU32(p,Math.floor(guestNow/1000));rt.writeU32(p+4,Math.round(guestNow%1000*1000));}if(c.argU32(1))rt.view(c.argU32(1),8).fill(0);return 0;});
rt.registerImport('clock_gettime',c=>{const p=c.argU32(1);rt.writeU32(p,Math.floor(guestNow/1000));rt.writeU32(p+4,Math.round(guestNow%1000*1e6));return 0;});
const game=installJNI(rt,{fs:libc.fs,onLog:()=>{}}),graphics=installGLES(rt,gl),audio=installAudio(rt,{fs:libc.fs,enabled:false,onLog:()=>{}});
const actions=new Map([[301,[0,270,245]],[303,[1,270,245]],[331,[0,70,447]],[333,[1,70,447]],[361,[0,270,245]],[363,[1,270,245]],[377,[0,150,370]],[379,[2,150,180]],[381,[1,150,180]],[391,[0,70,447]],[393,[1,70,447]],[421,[0,96,342]],[423,[1,96,342]],[480,[0,97,349]],[482,[1,97,349]],[1021,[0,160,292]],[1023,[1,160,292]],[1081,[0,260,250]],[1083,[1,260,250]],[1141,[0,260,250]],[1171,[1,260,250]]]);
const output=process.argv[2]||'render-output';await mkdir(output,{recursive:true});
const times=[],snapshots=[];let failure=null,completed=0;const start=performance.now();
function state(){const app=rt.readU32(rt.symbols.get('_ZN3App11s_pInstanceE')),controller=app?rt.readU32(app+4):0;return controller?rt.readU32(controller+0x14):null;}
async function snapshot(frame){const png=new PNG({width:320,height:480}),pixels=new Uint8Array(320*480*4);gl.finish();gl.readPixels(0,0,320,480,gl.RGBA,gl.UNSIGNED_BYTE,pixels);for(let y=0;y<480;y++)png.data.set(pixels.subarray(y*1280,(y+1)*1280),(479-y)*1280);await writeFile(`${output}/${frame}.png`,PNG.sync.write(png));const s={frame,state:state(),glError:gl.getError(),draws:graphics.stats.draws};snapshots.push(s);console.log('FRAME',JSON.stringify(s));}
try{
 rt.loadElf(await readFile(new URL('../game/libnttod.so',import.meta.url)));rt.constructors();game.startup({width:320,height:480});
 for(let frame=1;frame<=1200;frame++){
  guestNow=1700000000000+frame*1000/30;
  if(actions.has(frame))game.touch(...actions.get(frame),0);
  const a=performance.now();game.update();graphics.frame();libc.fs.flush();times.push(performance.now()-a);completed=frame;
  if(times.at(-1)>1000)console.log('SLOW',frame,times.at(-1));
  if(frame%30===0)await snapshot(frame);
 }
 game.pause();game.resume();game.update();
}catch(e){failure=e.stack;console.error(failure);process.exitCode=1;}
finally{const result={completed,failure,elapsedMs:performance.now()-start,times,snapshots,graphics:graphics.stats,native:rt.stats};await writeFile(`${output}/result.json`,JSON.stringify(result,null,2));console.log('RESULT',JSON.stringify({completed,failure,elapsedMs:result.elapsedMs,glErrors:graphics.stats.errors}));rt.dispose();}
