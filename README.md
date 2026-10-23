# Cottontown Beta

The test site: new features are tried here first. Features that work fully move to
[Cottontown Coach](https://github.com/darrenm2020/cottontown-coach), the app everyone uses.

A team and club app for youth soccer: live game tracking with subs and a rotation plan, a club scoreboard,
schedules with calendar feeds, messaging, fees, a coaching board and an AI coaching committee.
It's one page (`index.html`) plus Netlify Functions, deployed by Netlify from `main`.

## What's where

| Path | What it does |
|---|---|
| `index.html` | The whole app (game tracker, club page, schedule, board, coach, messages and fees). |
| `netlify/functions/state.mjs` | `/api/state`: team setups, games, parent stats, official (locked) results. |
| `netlify/functions/cal.mjs` | `/api/cal?t=TEAM[,TEAM]`: calendar feed people subscribe to. |
| `netlify/functions/coach.mjs` | `/api/coach`: "Coach the Coach" committee and AI-drawn plays (Claude). |
| `netlify/functions/club.mjs` | `/api/club`: members, invites, messages, fees and PayPal checkout. |
| `netlify/functions/help.mjs` | `/api/help`: the in-app help desk (answers from `netlify/lib/help-doc.mjs`) and help requests to admins. |
| `netlify/functions/report.mjs` | `/api/report`: problem reports the app sends automatically (errors, failed saves). |
| `netlify/functions/admin.mjs` | `/api/admin`: club admin tools (main code): help requests, problems, backups. |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | Home Screen install and push notifications (`netlify/lib/push.mjs` sends them; keys are made automatically). |
| `netlify/functions/backup-daily.mjs` | Runs nightly: copies all club data to the `cottontown-backups` store, kept 30 days. |
| `netlify/lib/` | Shared server code: members, messages, fees, the committee. |
| `tests/` | `npm test` runs the server tests; `tests/dev-server.mjs` runs the app locally. |

All data lives in Netlify Blobs (store `cottontown`).

## Settings in Netlify (Site configuration → Environment variables)

| Variable | Needed for | Notes |
|---|---|---|
| `COACH_CODE` | Everything coaches do | The main coach code. Already set. |
| `ANTHROPIC_API_KEY` | Coach the Coach, AI plays | Optional if Netlify's AI Gateway is on for the site (it supplies a key). Set your own to use your Anthropic account. |
| `COACH_MODEL` | AI | Defaults to `claude-opus-5-5`. If the AI Gateway doesn't offer it, set `claude-opus-4-8`. |
| `AI_MONTHLY_LIMIT` | AI | AI questions per team per month (default 150). |
| `HELP_DAILY_LIMIT` | Help desk | Help desk questions per day for the whole club (default 400; 30 per device). |

PayPal keys aren't environment variables: each payee (club treasurer or team manager) pastes their own
PayPal app's Client ID and Secret under Messages & fees → Fees → Payment settings.

## Who can do what

- **Club admin**: joined with the main coach code. Posts club announcements, bills the whole club, messages anyone.
- **Coach**: joined with a team code. Team chat, club coaches room, invites parents, bills their team, marks payments.
- **Parent**: joined with a coach's invite link and picked their player. Team chat, messages their team's coaches and parents, pays fees.

Today each device proves who it is with a private token it gets when the person joins. Adding sign-in
(Clerk: Google, Microsoft, Apple, email) only changes `whoami()` in `netlify/lib/members.mjs`.

## Supporting it

- **Coaches fix most problems themselves:** Setup → Fix a problem restores an earlier version of a game or the team
  setup (every save that removes data is kept, plus a copy every few minutes). Official results lock scores.
- **The help desk answers how-to questions** from `netlify/lib/help-doc.mjs`. Update that guide when features change.
  Anything it can't solve becomes a help request: club admins see it on the club page (Club admin → Help requests)
  and, from members, as a direct message.
- **Problems arrive on their own:** errors and failed saves from anyone's phone are listed under Club admin → Problems.
- **Backups:** nightly, 30 days, downloadable under Club admin → Backups (or Back up now).

## Working on it

```bash
npm install
npm test                                                      # server tests
FAKE_AI=1 node --import ./tests/register.mjs tests/dev-server.mjs 8888   # app at http://localhost:8888 with fake data and a fake AI
```
