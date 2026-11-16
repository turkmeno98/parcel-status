import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const contents=await fs.readFile(new URL('../.env.generated',import.meta.url),'utf8');
const key=contents.split(/\r?\n/).find(line=>line.startsWith('API_KEY=')).slice(8);
const base='https://parcel-status.parcel-status.workers.dev';
const response=await fetch(base+'/api/state',{headers:{Authorization:'Bearer '+key,Origin:'https://turkmeno98.github.io'}});
assert.equal(response.status,200);
assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://turkmeno98.github.io');
assert.equal(response.headers.get('Cache-Control'),'no-store');
const state=await response.json();
assert.ok(state.vapidPublicKey);
const anonymous=await fetch(base+'/api/state');assert.equal(anonymous.status,401);
const otherOrigin=await fetch(base+'/api/state',{headers:{Origin:'https://evil.test'}});assert.equal(otherOrigin.status,403);
console.log(JSON.stringify({api:'ok',anonymous:anonymous.status,otherOrigin:otherOrigin.status,
  cloudError:state.error,events:state.events.length,publicVapidKeyPresent:true}));
