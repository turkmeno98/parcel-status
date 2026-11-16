const CACHE='parcel-shell-v3';
const shell=['./','./index.html','./style.css','./app.js','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(shell)));});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('parcel-shell-') && key!==CACHE)await caches.delete(key);await self.clients.claim();})());});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET' || url.origin!==self.location.origin || url.pathname.includes('/api/'))return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok && shell.some(path=>new URL(path,self.registration.scope).pathname===url.pathname)){
      const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));
    }
    return response;
  }).catch(async()=>await caches.match(event.request) || (event.request.mode==='navigate' ? await caches.match('./index.html') : Response.error())));
});
self.addEventListener('push',event=>{
  let data={};try{data=event.data?.json() || {};}catch{}
  event.waitUntil(self.registration.showNotification('Посылка',{
    body:typeof data.body==='string' ? data.body.slice(0,300) : 'Обновился статус заказа',
    tag:typeof data.tag==='string' ? data.tag.slice(0,100) : 'parcel-status',
    icon:new URL('./icon-192.png',self.registration.scope).href,
    badge:new URL('./icon-192.png',self.registration.scope).href,
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});const existing=windows.find(client=>client.url.startsWith(self.registration.scope));if(existing)return existing.focus();return self.clients.openWindow(self.registration.scope);})());
});
