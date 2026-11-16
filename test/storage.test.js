import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const key='test-key-'.repeat(5);
const storage=()=>({values:new Map(),getItem(k){return this.values.get(k)??null;},setItem(k,v){this.values.set(k,v);},removeItem(k){this.values.delete(k);}});
async function boot(localStorage,sessionStorage=storage(),ok=true) {
  const elements=new Map(),requests=[];
  const element=id=>{
    if(!elements.has(id)) elements.set(id,{value:'',handlers:{},addEventListener(type,fn){this.handlers[type]=fn;},replaceChildren(){},append(){},showModal(){},close(){},setCustomValidity(){},reportValidity(){}});
    return elements.get(id);
  };
  await runInNewContext(`(async()=>{${source}\n})()`,{
    localStorage,sessionStorage,document:{getElementById:element,createElement:()=>({append(){}})},
    navigator:{userAgent:'test'},window:{},matchMedia:()=>({matches:false}),
    location:{search:'',reload(){}},URL,URLSearchParams,Intl,AbortSignal,
    fetch:async(url,options)=>{requests.push({url,authorization:options.headers.Authorization});return {ok,json:async()=>ok?{product:'Test',events:[],sheetConfigured:true}:{error:'UNAUTHORIZED'}};},
  });
  return {element,requests};
}
async function connect(app) {
  app.element('server').value='https://parcel-status.parcel-status.workers.dev';
  app.element('access-key').value=key;
  await app.element('connection-form').handlers.submit({preventDefault(){}});
}
test('successful connection survives a new browser session; explicit logout forgets it',async()=>{
  const local=storage();
  await connect(await boot(local));
  const reopened=await boot(local);
  assert.equal(reopened.requests[0]?.authorization,'Bearer '+key);
  reopened.element('disconnect').handlers.click();
  assert.equal((await boot(local)).requests.length,0);
});
test('existing session key migrates and logout clears both storage locations',async()=>{
  const local=storage(),session=storage();session.setItem('parcel-key',key);
  const app=await boot(local,session);
  assert.equal((await boot(local)).requests[0]?.authorization,'Bearer '+key);
  app.element('disconnect').handlers.click();
  assert.equal(local.getItem('parcel-key'),null);
  assert.equal(session.getItem('parcel-key'),null);
});
test('rejected key is never saved',async()=>{
  const local=storage();await connect(await boot(local,storage(),false));
  assert.equal(local.getItem('parcel-key'),null);
});

test('push subscription state is cleared when no browser subscription exists',async()=>{
  const local=storage();
  const app=await boot(local);
  assert.equal(app.requests.length,0);
});
