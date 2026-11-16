import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStatuses, mergeObservation, validateSubscription } from '../src/core.js';

const response = (date, name = 'В пути', id = '199') =>
  `[{"status_id":"${id}","status_name":"${name}","date":${date},"is_final":false}]`;

test('WB nanoseconds stay exact, while dates are valid UTC instants', () => {
  const [event] = parseStatuses(response('1794829439881323000'));
  assert.equal(event.key, '199:1794829439881323000');
  assert.equal(event.at, '2026-11-16T11:43:59.881Z');
});
test('rejects successful HTTP responses containing WB errors or empty data', () => {
  for (const raw of ['{"result":41}', '[]', '[{"status_id":"1"}]', '<html>']) {
    assert.throws(() => parseStatuses(raw));
  }
});
test('initial import is silent and repeated observations are idempotent', () => {
  const events = parseStatuses(response('1794829439881323000'));
  const first = mergeObservation(null, events);
  assert.deepEqual(first.changes, []);
  const again = mergeObservation(first.state, events);
  assert.deepEqual(again.changes, []);
  assert.equal(again.state.events.length, 1);
});
test('same status at a later exact timestamp is a new event; stale replies do not regress', () => {
  const initial = mergeObservation(null, parseStatuses(response('1794829439881323000'))).state;
  const next = mergeObservation(initial, parseStatuses(response('1794829439881323001')));
  assert.equal(next.changes.length, 1);
  const stale = mergeObservation(next.state, parseStatuses(response('1794829439881323000')));
  assert.equal(stale.state.latest.key, next.state.latest.key);
  assert.equal(stale.changes.length, 0);
});
test('only a real boolean can mark an order final', () => {
  const raw = response('1794829439881323000').replace('false', '"false"');
  assert.throws(() => parseStatuses(raw));
});
test('rejects private, redirected-looking and unknown push destinations', () => {
  const keys = {p256dh: 'B' + 'a'.repeat(86), auth: 'a'.repeat(22)};
  for (const endpoint of ['http://web.push.apple.com/x', 'https://127.0.0.1/x',
    'https://web.push.apple.com.evil.test/x', 'https://user@web.push.apple.com/x',
    'https://web.push.apple.com:8443/x']) {
    assert.throws(() => validateSubscription({endpoint,keys}));
  }
  assert.equal(validateSubscription({endpoint:'https://web.push.apple.com/x',keys}).endpoint,
    'https://web.push.apple.com/x');
});

test('corrected event updates its final flag without duplicate push',()=>{
  const previous=mergeObservation(null,parseStatuses(response('1794829439881323000'))).state;
  const corrected=parseStatuses(response('1794829439881323000').replace('false','true'));
  const result=mergeObservation(previous,corrected);
  assert.equal(result.state.latest.final,true);
  assert.equal(result.changes.length,0);
});

test('WB nested response from POST statuses parses all events in nanosecond order',()=>{
  const raw='[['+
    '{"rid":"test.order","status_id":"199","status_name":"В пути","date":1794824335923046000,"is_final":false},'+
    '{"rid":"test.order","status_id":"115","status_name":"В центре","date":1794829439881323000,"is_final":false}'+
    ']]';
  const events=parseStatuses(raw);
  assert.equal(events.length,2);
  assert.equal(events[1].key,'115:1794829439881323000');
  assert.equal(events[1].at,'2026-11-16T11:43:59.881Z');
  assert.throws(()=>parseStatuses('[[]]'));
});
