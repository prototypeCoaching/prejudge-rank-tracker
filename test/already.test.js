import { test } from 'node:test';
import assert from 'node:assert/strict';
import { already, main, COUNTRIES, questionCount } from '../rank.mjs';

// GitHub starts a scheduled job when it has a runner to spare, not when the cron says. In October 2026 that was
// five to seven and a half hours late every day, so the old guard ("is it 06:xx in Amsterdam?") was never true
// and nothing was read from 12 October. Nothing here looks at the clock: a run asks whether the day is done.

const APP = '6814166907';
const URL_ = 'https://cron.example/rankings';
const TOKEN = 'not-a-real-token';
const WANTED = questionCount();

function world({ have = null, haveStatus = 200 } = {}) {
  const calls = { apple: 0, get: 0, post: 0, posted: null };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes('itunes.apple.com')) {
      calls.apple += 1;
      return new Response(JSON.stringify({ results: [{ trackId: APP }] }), { status: 200 });
    }
    if ((init.method || 'GET') === 'GET') {
      calls.get += 1;
      if (haveStatus !== 200) return new Response('no', { status: haveStatus });
      return new Response(JSON.stringify(have), { status: 200 });
    }
    calls.post += 1;
    calls.posted = JSON.parse(init.body);
    return new Response('{"day":"2026-10-14","read":24}', { status: 200 });
  };
  return calls;
}

const env = (extra = {}) => ({
  RANKINGS_URL: URL_, RANKINGS_TOKEN: TOKEN, ASC_APP_ID: APP, RANKINGS_PAUSE_MS: '0', ...extra,
});

test('a day that is already written down is not read again', async () => {
  const calls = world({ have: { day: '2026-10-14', readings: WANTED, countries: COUNTRIES } });
  const out = await main(env());
  assert.equal(out.skipped, true);
  assert.equal(out.posted, 0);
  assert.equal(calls.apple, 0, 'Apple is not asked at all');
  assert.equal(calls.post, 0, 'and nothing is posted');
});

test('a day only half read is finished off', async () => {
  const calls = world({ have: { day: '2026-10-14', readings: 6, countries: ['nl'] } });
  const out = await main(env());
  assert.equal(out.skipped, undefined);
  assert.equal(out.posted, WANTED);
  assert.equal(calls.apple, WANTED, 'every term in every country is read');
  assert.equal(calls.post, 1);
});

test('a day with nothing written down is read', async () => {
  const calls = world({ have: { day: '2026-10-14', readings: 0, countries: [] } });
  const out = await main(env());
  assert.equal(out.posted, WANTED);
  assert.equal(calls.post, 1);
});

test('a dashboard that cannot be reached is not a reason to skip the day', async () => {
  // Posting a day twice replaces it, so reading when it may not be needed costs a little; not reading loses a day.
  const calls = world({ haveStatus: 503 });
  const out = await main(env());
  assert.equal(out.posted, WANTED);
  assert.equal(calls.apple, WANTED);
});

test('a run by hand reads the day whatever the dashboard already has', async () => {
  const calls = world({ have: { day: '2026-10-14', readings: WANTED, countries: COUNTRIES } });
  const out = await main(env({ RANKINGS_FORCE: '1' }));
  assert.equal(out.posted, WANTED);
  assert.equal(calls.get, 0, 'it does not even ask');
});

test('the question carries the day being asked about', async () => {
  let asked = null;
  globalThis.fetch = async (url) => {
    asked = String(url);
    return new Response(JSON.stringify({ day: '2026-10-14', readings: 0, countries: [] }), { status: 200 });
  };
  await already(URL_, TOKEN, '2026-10-14');
  assert.equal(asked, `${URL_}?day=2026-10-14`);
});
