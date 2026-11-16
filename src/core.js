export function parseStatuses(raw) {
  if (typeof raw !== 'string' || raw.length > 262144) throw new Error('WB_RESPONSE');
  // WB uses integer nanoseconds, beyond JavaScript's safe integer range.
  const rows = JSON.parse(raw.replace(/("date"\s*:\s*)(\d{16,22})(?=\s*[,}])/g, '$1"$2"'));
  if (!Array.isArray(rows) || !rows.length || rows.length > 200) throw new Error('WB_RESPONSE');
  const events = rows.map(row => {
    if (!row || typeof row.status_id !== 'string' || !/^\d{1,8}$/.test(row.status_id) ||
      typeof row.status_name !== 'string' || !row.status_name.trim() || row.status_name.length > 300 ||
      typeof row.date !== 'string' || !/^\d{16,22}$/.test(row.date) ||
      typeof row.is_final !== 'boolean') throw new Error('WB_RESPONSE');
    const ms = Number(BigInt(row.date) / 1000000n);
    if (ms < Date.UTC(2000, 0, 1) || ms > Date.UTC(2100, 0, 1)) throw new Error('WB_DATE');
    return {key: `${row.status_id}:${row.date}`, ns:row.date,
      at:new Date(ms).toISOString(), name:row.status_name.trim(), final:row.is_final};
  });
  return [...new Map(events.map(event => [event.key,event])).values()]
    .sort((a,b) => BigInt(a.ns) < BigInt(b.ns) ? -1 : BigInt(a.ns) > BigInt(b.ns) ? 1 : a.key.localeCompare(b.key));
}

export function mergeObservation(previous, events) {
  const merged = [...new Map([...(previous?.events || []), ...events].map(event => [event.key,event])).values()]
    .sort((a,b) => BigInt(a.ns) < BigInt(b.ns) ? -1 : BigInt(a.ns) > BigInt(b.ns) ? 1 : a.key.localeCompare(b.key))
    .slice(-100);
  const known = new Set((previous?.events || []).map(event => event.key));
  const changes = previous ? events.filter(event => !known.has(event.key) && (!previous.latest || BigInt(event.ns) >= BigInt(previous.latest.ns))) : [];
  return {state:{events:merged, latest:merged.at(-1) || null}, changes};
}

export function validateSubscription(value) {
  if (!value || typeof value.endpoint !== 'string' || value.endpoint.length > 2048) throw new Error('SUBSCRIPTION');
  const url = new URL(value.endpoint);
  const allowed = ['web.push.apple.com', 'fcm.googleapis.com', 'updates.push.services.mozilla.com'];
  if (url.protocol !== 'https:' || !allowed.includes(url.hostname) || url.port || url.username || url.password || url.hash ||
    !/^[A-Za-z0-9_-]{87}$/.test(value.keys?.p256dh || '') ||
    !/^[A-Za-z0-9_-]{22}$/.test(value.keys?.auth || '')) throw new Error('SUBSCRIPTION');
  return {endpoint:url.href, expirationTime:null, keys:{p256dh:value.keys.p256dh,auth:value.keys.auth}};
}

export async function authorize(header, secret) {
  if (typeof secret !== 'string' || secret.length < 32 || typeof header !== 'string' || header.length > 256) return false;
  const bytes = new TextEncoder();
  const [left,right] = await Promise.all([header, `Bearer ${secret}`].map(value => crypto.subtle.digest('SHA-256', bytes.encode(value))));
  const a = new Uint8Array(left), b = new Uint8Array(right);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
