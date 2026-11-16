const $=id=>document.getElementById(id);
let server=localStorage.getItem('parcel-server') || 'https://parcel-status.parcel-status.workers.dev';
let accessKey=localStorage.getItem('parcel-key') || sessionStorage.getItem('parcel-key') || '';
if (accessKey) {localStorage.setItem('parcel-key',accessKey);sessionStorage.removeItem('parcel-key');}
let state=null;
let registration=null;
let subscriptionConfirmed=false;
const demo=new URLSearchParams(location.search).has('demo');
const dateFormat=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'});
const errors={UNAUTHORIZED:'Ключ трекера не подошёл.',RATE_LIMIT:'Слишком много попыток. Попробуйте позже.',WB_SETUP:'На сервере ещё не настроен доступ к Wildberries.',WB_AUTH:'Нужно обновить доступ к Wildberries на сервере.',WB_RESPONSE:'Wildberries не вернул историю. Сохранён последний известный статус.',WB_DATE:'Не удалось прочитать время события Wildberries.',WB_UNAVAILABLE:'Wildberries сейчас недоступен. Сохранён последний известный статус.',SUBSCRIPTION:'Не удалось подключить уведомления этого браузера.',SUBSCRIPTION_LIMIT:'Подключено слишком много устройств.',NO_SUBSCRIPTION:'Сначала включите уведомления.',UNAVAILABLE:'Сервер временно недоступен.'};
errors.WB_TOKEN_FORMAT='В секрете WB_TOKEN сохранён не access token. Обновите его в Cloudflare, вставив только значение токена.';
const showMessage=text=>{$('message').textContent=text;};

async function api(path,options={}) {
  if (demo) throw new Error('В демонстрации нет подключения к серверу.');
  const response=await fetch(server+path,{...options,cache:'no-store',credentials:'omit',redirect:'error',
    headers:{Authorization:'Bearer '+accessKey,...(options.body ? {'Content-Type':'application/json'} : {})},
    signal:AbortSignal.timeout(20000)});
  const data=await response.json();
  if (!response.ok) throw new Error(errors[data.error] || 'Не удалось выполнить запрос.');
  return data;
}
function render() {
  $('product').textContent=state.product;
  const latest=state.events.at(-1);
  $('status-name').textContent=latest?.name==='Приехал в сортировочный центр' ? 'В сортировочном центре' : latest?.name || 'Ждём первую проверку';
  $('event-date').textContent=latest ? dateFormat.format(new Date(latest.at)) : 'Сервер проверит заказ после настройки доступа';
  $('checked-at').textContent=state.checkedAt ? 'Проверено '+dateFormat.format(new Date(state.checkedAt)) : 'Проверка ещё не выполнена';
  $('refresh').disabled=demo;
  $('timeline').replaceChildren();
  for (const event of [...state.events].reverse()) {
    const row=document.createElement('li'),name=document.createElement('strong'),time=document.createElement('time');
    name.textContent=event.name;time.dateTime=event.at;time.textContent=dateFormat.format(new Date(event.at));
    row.append(name,time);$('timeline').append(row);
  }
  if (!state.events.length) {const row=document.createElement('li');row.className='empty';row.textContent='Здесь появятся этапы доставки';$('timeline').append(row);}
  const link=state.sheetUrl;
  $('sheet-link').hidden=!link || !/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+/.test(link);
  if (!$('sheet-link').hidden) $('sheet-link').href=link;
  $('sheet-hint').textContent=state.sheetError ? 'Запись в Google Таблицу задерживается. История сохранена на сервере.' : !state.sheetConfigured && !demo ? 'Google Таблица ещё не подключена к серверу.' : '';
  showMessage(state.error ? errors[state.error] || 'Не удалось обновить статус.' : state.notificationError ? 'Доставка уведомления задерживается. Сервер повторит попытку.' : state.stopped ? 'Заказ завершён. Дальнейшие проверки остановлены.' : '');
}
async function updatePushControls() {
  const supported='serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const installed=matchMedia('(display-mode: standalone)').matches || navigator.standalone===true;
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
  $('install-hint').hidden=!ios || installed;
  const sub=registration ? await registration.pushManager.getSubscription() : null;
  if (!sub) subscriptionConfirmed=false;
  $('enable-push').textContent=sub && subscriptionConfirmed ? 'Уведомления включены' : 'Включить уведомления';
  $('enable-push').disabled=demo || !supported || (ios && !installed) || (Boolean(sub) && subscriptionConfirmed) || !state?.vapidPublicKey;
  $('push-controls').hidden=!sub;
  if (!supported && !ios) showMessage('Этот браузер не поддерживает push. Откройте приложение в Safari на iPhone или современном браузере.');
}
async function refresh(force=false) {
  $('refresh').disabled=true;
  try {state=await api(force ? '/api/poll' : '/api/state',{method:force?'POST':'GET'});render();await updatePushControls();}
  catch(error) {showMessage(error.message || 'Не удалось связаться с сервером.');}
  finally {$('refresh').disabled=!state || demo;}
}
function openSettings() {$('server').value=server;$('access-key').value=accessKey;$('settings').showModal();}
$('settings-open').addEventListener('click',openSettings);
$('settings-close').addEventListener('click',()=>$('settings').close());
$('refresh').addEventListener('click',()=>refresh(true));
$('connection-form').addEventListener('submit',async event=>{
  event.preventDefault();
  try {
    const url=new URL($('server').value);
    if (url.protocol!=='https:' || !url.hostname.endsWith('.workers.dev') || url.username || url.password || url.search || url.hash || (url.pathname!=='/' && url.pathname!=='')) throw new Error('Введите HTTPS-адрес сервера на workers.dev без пути и параметров.');
    const key=$('access-key').value.trim();
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(key)) throw new Error('Нужен ключ трекера, а не токен WB: 32–128 символов.');
    const oldServer=server,oldKey=accessKey;
    server=url.origin;accessKey=key;
    try {state=await api('/api/state');} catch(error) {server=oldServer;accessKey=oldKey;throw error;}
    localStorage.setItem('parcel-server',server);localStorage.setItem('parcel-key',accessKey);sessionStorage.removeItem('parcel-key');
    $('settings').close();render();await updatePushControls();
  } catch(error) {$('access-key').setCustomValidity(error.message);$('access-key').reportValidity();}
});
$('access-key').addEventListener('input',()=>$('access-key').setCustomValidity(''));
$('server').addEventListener('input',()=>$('access-key').setCustomValidity(''));
$('disconnect').addEventListener('click',()=>{localStorage.removeItem('parcel-key');sessionStorage.removeItem('parcel-key');accessKey='';location.reload();});
$('enable-push').addEventListener('click',async()=>{
  if (!state) {openSettings();return;}
  $('enable-push').disabled=true;
  try {
    if (await Notification.requestPermission()!=='granted') throw new Error('Уведомления не разрешены. Разрешение можно изменить в настройках устройства.');
    const key=Uint8Array.from(atob(state.vapidPublicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
    const existing=await registration.pushManager.getSubscription();
    const sub=existing || await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
    try {await api('/api/subscription',{method:'POST',body:JSON.stringify(sub.toJSON())});}
    catch(error) {if (!existing) await sub.unsubscribe();throw error;}
    subscriptionConfirmed=true;
    showMessage('Уведомления подключены. Отправьте тест, чтобы проверить доставку.');
  } catch(error) {showMessage(error.message || 'Не удалось включить уведомления.');}
  finally {await updatePushControls();}
});
$('disable-push').addEventListener('click',async()=>{
  try {const sub=await registration.pushManager.getSubscription();if(sub){await api('/api/subscription',{method:'DELETE',body:JSON.stringify(sub.toJSON())});await sub.unsubscribe();}subscriptionConfirmed=false;await updatePushControls();showMessage('Уведомления на этом устройстве отключены.');}
  catch(error){showMessage(error.message);}
});
$('test-push').addEventListener('click',async()=>{
  $('test-push').disabled=true;
  try {const result=await api('/api/test-push',{method:'POST'});showMessage(result.ok ? 'Тест отправлен. Проверьте уведомления устройства.' : 'Тест ожидает повторной отправки сервером.');}
  catch(error){showMessage(error.message);}finally{$('test-push').disabled=false;}
});
if ('serviceWorker' in navigator) {
  try {registration=await navigator.serviceWorker.register('./sw.js');await navigator.serviceWorker.ready;}
  catch {showMessage('Не удалось подготовить приложение к работе без сети.');}
}
if (demo) {
  $('demo-note').hidden=false;
  state={product:'VIVO X300 FE · 12 + 256 ГБ',checkedAt:'2026-11-16T16:46:00Z',events:[
    {name:'Прошёл сортировку',at:'2026-11-16T06:51:00Z'},
    {name:'Выезжает из транзитного центра',at:'2026-11-16T10:17:00Z'},
    {name:'Едет по маршруту',at:'2026-11-16T10:18:00Z'},
    {name:'Приехал в сортировочный центр',at:'2026-11-16T11:43:00Z'},
  ]};
  render();$('enable-push').textContent='Включить уведомления';$('enable-push').disabled=true;
} else if (server && accessKey) await refresh();
else if (server) showMessage('Введите ключ трекера в настройках, чтобы загрузить статус.');
