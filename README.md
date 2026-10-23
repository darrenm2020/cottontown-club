# Cottontown club app

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

PayPal keys aren't environment variables: each payee (club treasurer or team manager) pastes their own
PayPal app's Client ID and Secret under Messages & fees → Fees → Payment settings.

## Who can do what

- **Club admin**: joined with the main coach code. Posts club announcements, bills the whole club, messages anyone.
- **Coach**: joined with a team code. Team chat, club coaches room, invites parents, bills their team, marks payments.
- **Parent**: joined with a coach's invite link and picked their player. Team chat, messages their team's coaches and parents, pays fees.

Today each device proves who it is with a private token it gets when the person joins. Adding sign-in
(Clerk: Google, Microsoft, Apple, email) only changes `whoami()` in `netlify/lib/members.mjs`.

## Working on it

```bash
npm install
npm test                                                      # server tests
FAKE_AI=1 node --import ./tests/register.mjs tests/dev-server.mjs 8888   # app at http://localhost:8888 with fake data and a fake AI
```
