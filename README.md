# PREJUDGE rank tracker

Reads where the PREJUDGE app stands in the App Store search, once a day, and posts what it found to the PREJUDGE
dashboard. Six search terms in four countries, through Apple's own public search endpoint: no key, no permission,
two hundred results per question.

A term the app is not in is written down as "not in the list", never as a made-up 201. A number that is not real
looks like movement when it is not.

## Why this is its own repository

Asking from a Cloudflare Worker gets `429` on the first question of the run: Apple rate limits the addresses the
whole of Cloudflare shares. GitHub's runners have their own addresses, so the asking happens here, four seconds
apart, with a longer wait when Apple does say 429.

## What it holds

Nothing secret. The script reads everything from the environment, and the repository contains no addresses, tokens
or keys:

| Variable | What it is |
| --- | --- |
| `RANKINGS_URL` | where to post the readings. A repository secret. |
| `RANKINGS_TOKEN` | the token that address expects. A repository secret. |
| `ASC_APP_ID` | the app's App Store id, which is public. Defaults to the PREJUDGE app. |
| `RANKINGS_PAUSE_MS` | seconds between questions, in milliseconds. Four seconds by default. |
| `RANKINGS_TERMS`, `RANKINGS_COUNTRIES` | comma separated, for a run by hand. |

## When it runs

Every day at 06:40 Amsterdam, from `.github/workflows/rank.yml`. Two schedules, because Amsterdam moves against UTC
twice a year, and a guard so only the one that is 06:xx in Amsterdam does the work. It can also be started by hand
from the Actions tab.

## By hand

```sh
RANKINGS_URL=... RANKINGS_TOKEN=... node rank.mjs
```

## Tests

```sh
npm test
```

No network, no waiting: `fetch` is replaced and so is the pause between questions.

## What the dashboard does with it

It writes the readings down, one row per day, country and term, and draws the App Store rank tile and the line in
the morning briefing from them. A day that is posted twice replaces itself instead of doubling.
