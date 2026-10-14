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

// The six watched since the beginning, in every country, so the line on the dashboard keeps running.
export const TERMS = ['bodybuilding posing', 'posing', 'mandatory poses', 'posing practice', 'bodybuilding', 'posing app'];
export const COUNTRIES = ['nl', 'us', 'gb', 'de'];

/**
 * Terms worth more than the ones first picked, watched from 14 October 2026, before the keyword field changes in
 * 1.2.7. These are a guess about what people type, not a measurement: nothing here can see Apple's search volume,
 * and neither can anything else without App Store Connect's own search terms report or a paid tool. What this can
 * see is how many apps Apple returns for a term, which says how many others think it is worth competing for, and
 * where PREJUDGE stands in that list. "mandatory poses" returns one app in Germany; "bodybuilding" returns a
 * hundred and eighty five. A term with four results is not a term anybody searches.
 *
 * Per country, because the language is: a German searches "wettkampfvorbereitung", and NPC is a federation that
 * means nothing outside the United States.
 */
export const EXTRA_TERMS = {
  us: ['posing timer', 'bodybuilding app', 'contest prep', 'bikini posing', 'mens physique',
    'physique posing', 'posing coach', 'ifbb', 'npc', 'peak week'],
  gb: ['posing timer', 'bodybuilding app', 'contest prep', 'bikini posing', 'mens physique',
    'physique posing', 'posing coach', 'ifbb', 'bodybuilding competition', 'ukbff'],
  nl: ['posing timer', 'bodybuilding app', 'poseren', 'bodybuilding wedstrijd', 'fitness wedstrijd',
    'wedstrijd voorbereiding', 'bikini fitness', 'mens physique', 'ifbb', 'contest prep'],
  de: ['posing timer', 'bodybuilding app', 'posen', 'bodybuilding wettkampf', 'wettkampfvorbereitung',
    'fitness wettkampf', 'bikini fitness', 'mens physique', 'ifbb', 'posing training'],
};

/** Everything watched in one country: the six from the beginning, then that country's own. */
export const termsFor = (country) => [...TERMS, ...(EXTRA_TERMS[String(country).toLowerCase()] || [])];

/** How many questions a full run asks, which is also how it knows a day is finished. */
export const questionCount = (countries = COUNTRIES, terms = null) =>
  countries.reduce((n, c) => n + (terms || termsFor(c)).length, 0);

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
  appId, terms = null, countries = COUNTRIES, pause = 4000, wait = sleep, log = () => {},
} = {}) {
  const readings = [];
  const missed = [];
  for (const country of countries) {
    // Each country has its own list, because the language is. A term given by hand goes to all of them.
    for (const term of terms || termsFor(country)) {
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

/**
 * What the dashboard already has for a day.
 *
 * GitHub starts a scheduled job when it gets round to it. In October 2026 these runs were between five and seven
 * and a half hours late, every single day, so a guard asking "is it six in the morning in Amsterdam" was never
 * true and the rank was never read. A run cannot tell by the clock whether it is the day's run. It asks.
 *
 * An answer that cannot be got is not a reason to do nothing: posting a day twice is an upsert, so when this
 * cannot be reached the run goes ahead and reads anyway.
 */
export async function already(url, token, day) {
  const res = await fetch(`${url}?day=${encodeURIComponent(day)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
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

  const terms = env.RANKINGS_TERMS ? env.RANKINGS_TERMS.split(',').map((t) => t.trim()).filter(Boolean) : null;
  const countries = env.RANKINGS_COUNTRIES ? env.RANKINGS_COUNTRIES.split(',').map((c) => c.trim().toLowerCase()).filter(Boolean) : COUNTRIES;
  const pause = Number(env.RANKINGS_PAUSE_MS || 4000);

  const day = amsDay();
  const wanted = questionCount(countries, terms);
  // A day that is already fully written down is left alone. A day that is only partly there is read again, so a
  // run that Apple cut short gets another go later the same day.
  if (!/^(1|true|yes)$/i.test(String(env.RANKINGS_FORCE || ''))) {
    const have = await already(url, token, day).catch(() => null);
    if (have && have.readings >= wanted) {
      console.log(`${day} already has ${have.readings} readings (${have.countries.join(', ')}). Apple is not asked again.`);
      return { day, posted: 0, missed: 0, skipped: true };
    }
    if (have && have.readings) console.log(`${day} has ${have.readings} of ${wanted} readings so far. Reading the rest.`);
  }

  const { readings, missed } = await readAll({ appId, terms, countries, pause, log: (line) => console.log(line) });
  if (!readings.length) throw new Error(`Apple answered nothing for any of the ${wanted} questions. ${missed[0] || ''}`);

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
