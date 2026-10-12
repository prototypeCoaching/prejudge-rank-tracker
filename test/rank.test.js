import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookUp, ask, readAll, post, amsDay, TERMS, COUNTRIES } from '../rank.mjs';

// No network and no waiting: fetch is replaced, and so is the pause between questions.

const APP = '6814166907';
const now = () => {};
const answer = (ids, status = 200) => new Response(JSON.stringify({ results: ids.map((trackId) => ({ trackId })) }), {
  status, headers: { 'content-type': 'application/json' },
});

function world(reply) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: (init && init.method) || 'GET', body: init && init.body });
    return reply(String(url), init);
  };
  return calls;
}

test('a place is counted from one, and not being in the list is not a number', async () => {
  world(() => answer([111, 222, APP, 333]));
  assert.deepEqual(await lookUp(APP, 'posing', 'nl'), { position: 3, results: 4 });

  world(() => answer([111, 222]));
  assert.deepEqual(await lookUp(APP, 'posing', 'nl'), { position: null, results: 2 });
});

test('the question carries the term, the country and Apple’s two hundred', async () => {
  const calls = world(() => answer([APP]));
  await lookUp(APP, 'mandatory poses', 'de');
  const url = new URL(calls[0].url);
  assert.equal(url.host, 'itunes.apple.com');
  assert.equal(url.searchParams.get('term'), 'mandatory poses');
  assert.equal(url.searchParams.get('country'), 'de');
  assert.equal(url.searchParams.get('limit'), '200');
  assert.equal(url.searchParams.get('entity'), 'software');
});

test('a 429 is waited out, and a waited-out term says so instead of becoming a zero', async () => {
  let tries = 0;
  const waits = [];
  world(() => {
    tries += 1;
    return tries < 3 ? new Response('slow down', { status: 429 }) : answer([APP]);
  });
  const got = await ask(APP, 'posing', 'nl', { pause: 10, wait: async (ms) => { waits.push(ms); } });
  assert.deepEqual(got, { position: 1, results: 1 });
  assert.equal(tries, 3);
  assert.deepEqual(waits, [50, 100], 'a 429 waits five times longer each go');

  world(() => new Response('no', { status: 429 }));
  await assert.rejects(() => ask(APP, 'posing', 'nl', { pause: 1, wait: async () => {} }), /429/);
});

test('a term Apple will not answer does not take the other twenty-three with it', async () => {
  world((url) => (url.includes('bodybuilding') ? new Response('no', { status: 500 }) : answer([APP])));
  const { readings, missed } = await readAll({
    appId: APP, terms: ['posing', 'bodybuilding'], countries: ['nl', 'us'], pause: 0, wait: async () => {},
  });
  assert.equal(readings.length, 2);
  assert.equal(missed.length, 2);
  assert.deepEqual(readings.map((r) => r.country), ['nl', 'us']);
  assert.match(missed[0], /500/);
});

test('what is posted is the day in Amsterdam and the readings, behind the token', async () => {
  const calls = world(() => new Response('{"read":2}', { status: 200 }));
  await post('https://example.test/rankings', 'a-token', { day: '2026-10-12', readings: [{ country: 'nl' }] });
  assert.equal(calls[0].method, 'POST');
  assert.equal(JSON.parse(calls[0].body).day, '2026-10-12');

  world(() => new Response('No.', { status: 401 }));
  await assert.rejects(() => post('https://example.test/rankings', 'wrong', { readings: [] }), /401/);

  // the day is Amsterdam's, not the runner's: a run at 23:30 UTC belongs to the next day here
  assert.equal(amsDay(new Date('2026-07-12T23:30:00Z')), '2026-07-13');
  assert.equal(amsDay(new Date('2026-01-12T12:00:00Z')), '2026-01-12');
});

test('the watched searches are the ones the dashboard shows', () => {
  assert.deepEqual(COUNTRIES, ['nl', 'us', 'gb', 'de']);
  assert.equal(TERMS.length, 6);
  assert.ok(TERMS.includes('bodybuilding posing'));
  assert.equal(typeof now, 'function');
});
