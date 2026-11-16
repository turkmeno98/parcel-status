import { buildPushPayload } from '@block65/webcrypto-web-push';
import { authorize, mergeObservation, parseStatuses, validateSubscription } from './core.js';

const json = (value, status = 200) => Response.json(value, {status,headers:{
  'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer', 'Strict-Transport-Security':'max-age=31536000',
  'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",
}});
const fail = (code,status) => json({error:code},status);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      if (url.pathname.startsWith('/internal/')) return fail('FORBIDDEN',403);
      return env.ASSETS ? env.ASSETS.fetch(request) : fail('NOT_FOUND',404);
    }
    const origin = request.headers.get('Origin');
    const allowed = origin === env.APP_ORIGIN || origin === url.origin;
    if (origin && !allowed) return fail('ORIGIN',403);
    if (request.method === 'OPTIONS') {
      if (!allowed) return fail('ORIGIN',403);
      return new Response(null,{status:204,headers:{
        'Access-Control-Allow-Origin':origin,'Vary':'Origin',
        'Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers':'Authorization, Content-Type',
        'Access-Control-Max-Age':'600',
      }});
    }
    try {
      const stub = env.MONITOR.get(env.MONITOR.idFromName('owner'));
      const result = await stub.fetch(request);
      const response = new Response(result.body,result);
      if (allowed) {
        response.headers.set('Access-Control-Allow-Origin',origin);
        response.headers.set('Vary','Origin');
      }
      return response;
    } catch { return fail('UNAVAILABLE',503); }
  },
  async scheduled(_event,env,ctx) {
    const stub = env.MONITOR.get(env.MONITOR.idFromName('owner'));
    ctx.waitUntil(stub.fetch(new Request('https://monitor/internal/poll',{method:'POST'})));
  },
};

export class Monitor {
  constructor(ctx,env) { this.storage=ctx.storage; this.env=env; this.tail=Promise.resolve(); }
  exclusive(action) {
    const job=this.tail.then(action);
    this.tail=job.catch(()=>{});
    return job;
  }
  fetch(request) { return this.exclusive(()=>this.handle(request)); }
  async handle(request) {
    const path = new URL(request.url).pathname;
    // Internal requests are made only by this Worker's scheduled handler.
    if (path === '/internal/poll') { await this.poll(); return json({ok:true}); }
    const ipHash = new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(
      (this.env.API_KEY || '') + (request.headers.get('CF-Connecting-IP') || 'local'))));
    const bucketKey = 'auth:' + [...ipHash.slice(0,12)].map(n=>n.toString(16).padStart(2,'0')).join('');
    const failures = await this.storage.get(bucketKey);
    if (failures?.until > Date.now() && failures.count >= 10) return fail('RATE_LIMIT',429);
    if (!await authorize(request.headers.get('Authorization'),this.env.API_KEY)) {
      await this.storage.put(bucketKey,{until:failures?.until > Date.now() ? failures.until : Date.now()+900000,
        count:failures?.until > Date.now() ? failures.count+1 : 1});
      return fail('UNAUTHORIZED',401);
    }
    if (request.method==='GET' && path==='/api/state') return json(await this.view());
    if (request.method==='POST' && path==='/api/poll') { await this.poll(); return json(await this.view()); }
    if (path==='/api/subscription' && ['POST','DELETE'].includes(request.method)) {
      let subscription;
      try { subscription=validateSubscription(await readJson(request)); }
      catch { return fail('SUBSCRIPTION',422); }
      const state=await this.load();
      state.subscriptions=state.subscriptions.filter(item=>item.endpoint!==subscription.endpoint);
      if (request.method==='POST') {
        if (state.subscriptions.length>=5) return fail('SUBSCRIPTION_LIMIT',409);
        state.subscriptions.push(subscription);
      }
      state.deliveries=state.deliveries.filter(job=>job.endpoint!==subscription.endpoint);
      await this.storage.put('state',state);
      return json({ok:true});
    }
    if (request.method==='POST' && path==='/api/test-push') {
      const state=await this.load();
      if (state.testedAt && Date.now()-Date.parse(state.testedAt)<60000) return fail('RATE_LIMIT',429);
      if (!state.subscriptions.length) return fail('NO_SUBSCRIPTION',409);
      state.testedAt=new Date().toISOString();
      const event={key:'test:'+Date.now(),name:'Проверка уведомлений: всё подключено'};
      state.deliveries.push(...state.subscriptions.map(sub=>({endpoint:sub.endpoint,event})));
      await this.storage.put('state',state);
      await this.flush(state);
      return json({ok:!state.deliveries.some(job=>job.event.key===event.key)});
    }
    return fail('NOT_FOUND',404);
  }
  async load() {
    return await this.storage.get('state') || {events:[],latest:null,subscriptions:[],deliveries:[],sheetQueue:[]};
  }
  async view() {
    const state=await this.load();
    return {product:this.env.PRODUCT_NAME || 'Ваш заказ',events:state.events,
      checkedAt:state.checkedAt || null, error:state.error || null,
      upstreamStatus:state.upstreamStatus || null, transportError:state.transportError || null,
      pendingPush:state.deliveries.length, notificationError:state.notificationError || null,
      sheetError:state.sheetError || null, sheetConfigured:Boolean(this.env.SHEETS_WEBHOOK_URL),
      sheetUrl:this.env.SHEET_URL || null, vapidPublicKey:this.env.VAPID_PUBLIC_KEY || null,
      stopped:state.latest?.final || false};
  }
  async poll() {
    const state=await this.load();
    if (state.attemptedAt && Date.now()-Date.parse(state.attemptedAt)<60000) return;
    if (state.latest?.final) { await this.flush(state); return; }
    state.attemptedAt=new Date().toISOString();
    state.upstreamStatus=null;
    state.transportError=null;
    await this.storage.put('state',state);
    try {
      if (!this.env.WB_TOKEN || !this.env.WB_RID) throw new Error('WB_SETUP');
      if (!/^[A-Za-z0-9._-]{1,180}$/.test(this.env.WB_RID)) throw new Error('WB_SETUP');
      const wbToken=this.env.WB_TOKEN.trim().replace(/^Bearer\s+/i,'');
      if (wbToken.length>8000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(wbToken)) throw new Error('WB_TOKEN_FORMAT');
      const result=await fetch('https://status-tracker.wb.ru/api/v6/statuses/'+this.env.WB_RID+'?lang=ru',{
        headers:{Authorization:'Bearer '+wbToken,Accept:'application/json'},
        redirect:'manual',signal:AbortSignal.timeout(15000),
      });
      state.upstreamStatus=result.status;
      if ([401,403].includes(result.status)) throw new Error('WB_AUTH');
      if (!result.ok) throw new Error('WB_UNAVAILABLE');
      const events=parseStatuses(await result.text());
      const {state:observation,changes}=mergeObservation(state.latest ? state : null,events);
      // Import WB history only on first read; later append newly observed events.
      const rowsForSheet=state.latest ? changes : events;
      Object.assign(state,observation,{checkedAt:new Date().toISOString(),error:null});
      state.deliveries.push(...changes.flatMap(event=>state.subscriptions.map(sub=>({endpoint:sub.endpoint,event}))));
      if (this.env.SHEETS_WEBHOOK_URL) state.sheetQueue.push(...rowsForSheet);
      await this.storage.put('state',state);
    } catch (error) {
      if (!state.upstreamStatus) state.transportError=['TimeoutError','AbortError','TypeError'].includes(error.name) ? error.name : 'NetworkError';
      state.error=['WB_SETUP','WB_TOKEN_FORMAT','WB_AUTH','WB_RESPONSE','WB_DATE','WB_UNAVAILABLE'].includes(error.message) ? error.message : 'WB_UNAVAILABLE';
      await this.storage.put('state',state);
    }
    await this.flush(state);
  }
  async flush(state) {
    state.notificationError=null;
    const pending=[];
    for (const job of state.deliveries) {
      const sub=state.subscriptions.find(item=>item.endpoint===job.endpoint);
      if (!sub) continue;
      try {
        validateSubscription(sub);
        if (!this.env.VAPID_PRIVATE_KEY || !this.env.VAPID_PUBLIC_KEY) throw new Error('PUSH_SETUP');
        const request=await buildPushPayload({data:JSON.stringify({title:'Посылка',body:job.event.name,tag:job.event.key}),options:{ttl:3600}},sub,{
          subject:this.env.VAPID_SUBJECT,publicKey:this.env.VAPID_PUBLIC_KEY,privateKey:this.env.VAPID_PRIVATE_KEY,
        });
        const response=await fetch(sub.endpoint,{...request,redirect:'manual',signal:AbortSignal.timeout(10000)});
        if ([404,410].includes(response.status)) {
          state.subscriptions=state.subscriptions.filter(item=>item.endpoint!==sub.endpoint);
        } else if (!response.ok) throw new Error('PUSH_UNAVAILABLE');
      } catch {pending.push(job);state.notificationError='PUSH_UNAVAILABLE';}
      // shortcut: a crash between delivery and acknowledgement can redeliver; tags collapse duplicates on device.
    }
    state.deliveries=pending.slice(-100);
    if (state.sheetQueue.length && this.env.SHEETS_WEBHOOK_URL) {
      try {
        const url=new URL(this.env.SHEETS_WEBHOOK_URL);
        if (url.origin!=='https://script.google.com' || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) || !this.env.SHEETS_WEBHOOK_SECRET) throw new Error('SHEETS_SETUP');
        const result=await fetch(url.href,{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({secret:this.env.SHEETS_WEBHOOK_SECRET,product:this.env.PRODUCT_NAME,events:state.sheetQueue.slice(0,100)}),
          redirect:'manual',signal:AbortSignal.timeout(15000)});
        // Apps Script ContentService redirects once to a Google-owned result URL.
        let reply=result;
        if ([301,302,303].includes(result.status)) {
          const target=new URL(result.headers.get('Location'));
          if (target.protocol!=='https:' || target.hostname!=='script.googleusercontent.com') throw new Error('SHEETS_REDIRECT');
          reply=await fetch(target.href,{redirect:'manual',signal:AbortSignal.timeout(10000)});
        }
        if (!reply.ok || (await reply.json()).ok!==true) throw new Error('SHEETS_RESPONSE');
        state.sheetQueue=state.sheetQueue.slice(100);state.sheetError=null;
      } catch {state.sheetError='SHEETS_UNAVAILABLE';}
    }
    // Keep pending queue bounded during extended outages; WB history remains in events.
    state.sheetQueue=state.sheetQueue.slice(-100);
    await this.storage.put('state',state);
  }
}

async function readJson(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new Error('CONTENT_TYPE');
  const reader=request.body?.getReader();
  if (!reader) throw new Error('BODY');
  const chunks=[];let length=0;
  for (;;) {
    const {done,value}=await reader.read();if (done) break;
    length+=value.length;
    if (length>4096) {await reader.cancel();throw new Error('BODY_SIZE');}
    chunks.push(value);
  }
  const combined=new Uint8Array(length);let offset=0;
  for (const chunk of chunks) {combined.set(chunk,offset);offset+=chunk.length;}
  return JSON.parse(new TextDecoder().decode(combined));
}
