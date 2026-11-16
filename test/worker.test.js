import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { Monitor } from '../src/worker.js';
const key = 'test-only-key-with-at-least-32-characters';
function fixture() {
  const data = new Map();
  const env = {API_KEY:key, WB_TOKEN:'test-only', WB_RID:'test.order', APP_ORIGIN:'https://example.github.io', APP_URL:'https://example.github.io/parcel/', VAPID_PUBLIC_KEY:'test'};
  const monitor = new Monitor({storage:{get: async k => structuredClone(data.get(k)),put:async(k,v)=>data.set(k,structuredClone(v))}},env);
  return {monitor,env,data};
}
test('API refuses unknown origins and direct access to internal routes', async () => {
  const {env} = fixture();
  for (const [path,origin] of [['/internal/poll',env.APP_ORIGIN],['/api/state','https://evil.test']]) {
    const res = await worker.fetch(new Request('https://worker.test'+path,{headers:{Origin:origin}}),env);
    assert.equal(res.status,403);
  }
});
test('state is private and invalid credentials are rate limited', async () => {
  const {monitor} = fixture();
  for (let i=0;i<10;i++) {
    const res = await monitor.fetch(new Request('https://monitor/api/state'));
    assert.equal(res.status,401);
  }
  const limited = await monitor.fetch(new Request('https://monitor/api/state'));
  assert.equal(limited.status,429);
});
test('a WB failure preserves history, latest event and records an actionable error', async () => {
  const {monitor,data} = fixture();
  const event = {key:'1:1794829439881323000',ns:'1794829439881323000',name:'В пути',at:'2026-11-16T11:43:59.881Z',final:false};
  data.set('state',{events:[event],latest:event,deliveries:[],sheetQueue:[],subscriptions:[]});
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"result":41}');
  try {
    await monitor.poll();
    assert.equal(data.get('state').latest.key,event.key);
    assert.equal(data.get('state').events.length,1);
    assert.equal(data.get('state').error,'WB_RESPONSE');
  } finally {globalThis.fetch = oldFetch;}
});
test('first successful observation is silent and repeated response creates no push jobs', async () => {
  const {monitor,data} = fixture();
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('[{"status_id":"115","status_name":"В центре","date":1794829439881323000,"is_final":false}]');
  try {
    await monitor.poll();
    assert.equal(data.get('state').events.length,1);
    assert.equal(data.get('state').deliveries.length,0);
    data.get('state').attemptedAt = null;
    await monitor.poll();
    assert.equal(data.get('state').events.length,1);
    assert.equal(data.get('state').deliveries.length,0);
  } finally {globalThis.fetch = oldFetch;}
});
test('failed push stays queued and repeated WB data does not duplicate the job',async()=>{
  const {monitor,data}=fixture();
  const oldFetch=globalThis.fetch;
  let raw='[{"status_id":"199","status_name":"В пути","date":1794829439881323000,"is_final":false}]';
  globalThis.fetch=async()=>new Response(raw);
  try {
    await monitor.poll();
    const state=data.get('state');
    state.subscriptions=[{endpoint:'https://web.push.apple.com/test',keys:{p256dh:'B'+'a'.repeat(86),auth:'a'.repeat(22)}}];
    state.attemptedAt=null;
    raw='[{"status_id":"115","status_name":"В центре","date":1794829439881323001,"is_final":false}]';
    await monitor.poll();
    assert.equal(data.get('state').deliveries.length,1);
    assert.equal(data.get('state').notificationError,'PUSH_UNAVAILABLE');
    data.get('state').attemptedAt=null;
    await monitor.poll();
    assert.equal(data.get('state').deliveries.length,1);
    assert.equal(data.get('state').latest.key,'115:1794829439881323001');
  } finally {globalThis.fetch=oldFetch;}
});
