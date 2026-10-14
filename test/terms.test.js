import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TERMS, COUNTRIES, EXTRA_TERMS, termsFor, questionCount, readAll } from '../rank.mjs';

// Ten more searches per country, watched from 14 October 2026, so there is a starting position to compare with
// after the keyword field changes in 1.2.7. Nothing here can see Apple's search volume; what it can see is where
// PREJUDGE stands and how many apps Apple returns, which is how many others think the term is worth having.

test('every country keeps the six watched from the beginning', () => {
  for (const country of COUNTRIES) {
    for (const term of TERMS) assert.ok(termsFor(country).includes(term), `${country} lost "${term}"`);
  }
});

test('each country has ten of its own, and the language is the country’s', () => {
  for (const country of COUNTRIES) {
    assert.equal(EXTRA_TERMS[country].length, 10, country);
    assert.equal(termsFor(country).length, 16, country);
  }
  assert.ok(EXTRA_TERMS.de.includes('wettkampfvorbereitung'), 'German searches in German');
  assert.ok(EXTRA_TERMS.nl.includes('bodybuilding wedstrijd'), 'Dutch searches in Dutch');
  // NPC is an American federation and UKBFF a British one. Watching either in the other place is watching noise.
  assert.ok(EXTRA_TERMS.us.includes('npc'));
  assert.ok(!EXTRA_TERMS.gb.includes('npc'));
  assert.ok(EXTRA_TERMS.gb.includes('ukbff'));
  assert.ok(!EXTRA_TERMS.us.includes('ukbff'));
});

test('no term is watched twice in the same country', () => {
  for (const country of COUNTRIES) {
    const list = termsFor(country);
    assert.equal(new Set(list).size, list.length, `${country} watches something twice`);
  }
});

test('a day is only finished when every country has answered its own list', () => {
  assert.equal(questionCount(), 64);
  assert.equal(questionCount(['de']), 16);
  // a run by hand with its own terms asks that many in each country, and nothing else
  assert.equal(questionCount(['nl', 'us'], ['posing']), 2);
});

test('a country is asked its own list, not everybody’s', async () => {
  const asked = [];
  globalThis.fetch = async (url) => {
    const q = new URL(String(url)).searchParams;
    asked.push(`${q.get('country')}|${q.get('term')}`);
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  };
  const { readings } = await readAll({ appId: '1', countries: ['de', 'us'], pause: 0, wait: async () => {} });
  assert.equal(readings.length, 32);
  assert.ok(asked.includes('de|wettkampfvorbereitung'));
  assert.ok(asked.includes('us|npc'));
  assert.ok(!asked.includes('us|wettkampfvorbereitung'), 'a German term is not asked in the United States');
  assert.ok(!asked.includes('de|npc'));
});
