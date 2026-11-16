import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {buildPushPayload} from '@block65/webcrypto-web-push';
import {authorize} from '../src/core.js';
test('tracker authentication compares the whole separate access key', async()=>{
  const key='a'.repeat(43);
  assert.equal(await authorize('Bearer '+key,key),true);
  assert.equal(await authorize('Bearer '+key+'x',key),false);
  assert.equal(await authorize('Bearer '+key.slice(1),key),false);
  assert.equal(await authorize(null,key),false);
  assert.equal(await authorize('Bearer x','x'),false);
});
test('push library creates Apple-compatible encrypted aes128gcm payload',async()=>{
  const server=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({format:'jwk'});
  const browser=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({format:'jwk'});
  const raw=jwk=>Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]).toString('base64url');
  const request=await buildPushPayload({data:JSON.stringify({body:'В пути'}),options:{ttl:60}},{
    endpoint:'https://web.push.apple.com/test',keys:{p256dh:raw(browser),auth:randomBytes(16).toString('base64url')},
  },{subject:'https://example.github.io/parcel/',publicKey:raw(server),privateKey:server.d});
  assert.equal(request.method.toUpperCase(),'POST');
  const headers=new Headers(request.headers);
  assert.equal(headers.get('Content-Encoding'),'aes128gcm');
  assert.match(headers.get('Authorization'),/^vapid /);
  assert.ok(request.body.byteLength>0);
});
