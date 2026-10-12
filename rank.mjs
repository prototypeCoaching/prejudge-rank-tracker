// Where PREJUDGE stands in the App Store search, asked once a day and posted to the dashboard.
//
// Apple's public search endpoint is the same one the store uses: no key, no permission, two hundred results per
// question. A term the app is not in is written down as "not in the list", never as a made-up 201, because a
// number that is not real looks like movement when it is not.
//
// Why this is its own repository: asking from a Cloudflare Worker gets 429 on the first question of the run, since
// Apple rate limits the addresses the whole of Cloudflare shares. GitHub's runners have their own addresses, and
// this run goes slowly on purpose.
//
// It holds no secrets. Everything it needs comes from the environment:
//   RANKINGS_URL    where to post the readings (a GitHub Actions secret)
//   RANKINGS_TOKEN  the token that address expects (a GitHub Actions secret)
//   ASC_APP_ID      the app's App Store id, which is public (it is in every App Store link)
//   RANKINGS_PAUSE_MS, RANKINGS_TERMS, RANKINGS_COUNTRIES  optional, for a run by hand

export const TERMS = ['bodybuilding posing', 'posing', 'mandatory poses', 'posing practice', 'bodybuilding', 'posing app'];
export const COUNTRIES = ['nl', 'us', 'gb', 'de'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The day in Amsterdam, which is the day the dashboard counts in. */
export const amsDay = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);

/** One question to Apple: where is this app in the list for this term, in this country? */
export async function lookUp(appId, term, country) {
  const q = new URLSearchParams({ term, country, entity: 'software', limit: '200' });
  const res = await fetch(`https://itunes.apple.com/search?${q}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Apple's search answered ${res.status}`);
  const body = await res.json().catch(() => ({ results: [] }));
  const list = body.results || [];
  const at = list.findIndex((x) => String(x.trackId) === String(appId));
  return { position: at < 0 ? null : at + 1, results: list.length };
}

/** One question, with room for Apple to say "slow down" twice before that term is given up on. */
export async function ask(appId, term, country, { tries = 3, pause = 4000, wait = sleep } = {}) {
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      return await lookUp(appId, term, country);
    } catch (err) {
      const message = String(err && err.message ? err.message : err);
      if (attempt === tries) throw new Error(message);
      // 429 means wait longer, not try harder.
      await wait(pause * (/429/.test(message) ? attempt * 5 : attempt));
    }
  }
  return null;
}

/** Every term in every country, slowly. Returns what Apple answered and what it would not answer. */
export async function readAll({
  appId, terms = TERMS, countries = COUNTRIES, pause = 4000, wait = sleep, log = () => {},
} = {}) {
  const readings = [];
  const missed = [];
  for (const country of countries) {
    for (const term of terms) {
      try {
        const { position, results } = await ask(appId, term, country, { pause, wait });
        readings.push({ country, term, position, results });
        log(`${country} "${term}": ${position ? `place ${position}` : 'not in the list'} (${results} results)`);
      } catch (err) {
        missed.push(`${country} "${term}": ${err.message}`);
        log(`${country} "${term}": ${err.message}`);
      }
      await wait(pause);
    }
  }
  return { readings, missed };
}

/** Hand them over. The dashboard writes them down; nothing is stored here. */
export async function post(url, token, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`The dashboard answered ${res.status}: ${text.slice(0, 200)}`);
  return text;
}

export async function main(env = process.env) {
  const url = env.RANKINGS_URL;
  const token = env.RANKINGS_TOKEN;
  const appId = env.ASC_APP_ID;
  if (!url) throw new Error('RANKINGS_URL is not set');
  if (!token) throw new Error('RANKINGS_TOKEN is not set');
  if (!appId) throw new Error('ASC_APP_ID is not set');

  const terms = env.RANKINGS_TERMS ? env.RANKINGS_TERMS.split(',').map((t) => t.trim()).filter(Boolean) : TERMS;
  const countries = env.RANKINGS_COUNTRIES ? env.RANKINGS_COUNTRIES.split(',').map((c) => c.trim().toLowerCase()).filter(Boolean) : COUNTRIES;
  const pause = Number(env.RANKINGS_PAUSE_MS || 4000);

  const day = amsDay();
  const { readings, missed } = await readAll({ appId, terms, countries, pause, log: (line) => console.log(line) });
  if (!readings.length) throw new Error(`Apple answered nothing for any of the ${countries.length * terms.length} questions. ${missed[0] || ''}`);

  const answer = await post(url, token, { day, readings });
  console.log(`posted ${readings.length} readings for ${day}${missed.length ? `, ${missed.length} questions Apple would not answer` : ''}: ${answer.slice(0, 200)}`);
  return { day, posted: readings.length, missed: missed.length };
}

// Only when run, not when imported by the tests.
if (process.argv[1] && process.argv[1].endsWith('rank.mjs')) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
