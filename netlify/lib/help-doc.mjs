// The app's user guide. The in-app help desk answers from this, so keep it in step with the app.
export const HELP_DOC = `
# Team app user guide

## The basics
- The club page (open the app with no team) shows every team's games: Live now, Coming up, Results this past week, and a Teams view. Tap a game or team to follow it.
- A team page shows one team: the clock, score, field and tabs. Parents can follow without signing in.
- Coaches unlock a team with the coach code (Setup tab, or the prompt shown on a team page). The main coach code works for every team and makes that device a club admin. A team's own coach code works for that team.
- Changes save automatically and sync to every phone within a couple of seconds. "All changes saved" means the server has it.

## Running a game (coaches)
- Pick the game in the strip at the top, then Kick off. Pause and Resume as needed; "Start 2nd half" appears at halftime.
- Subs: tap a player on the field, then a bench player (or tap a bench player, then a spot). The Bench tab shows who is sitting and for how long.
- Rotation plan (Setup tab, team setting): plans who plays when, in blocks (usually 10 minutes). A banner appears a minute before each planned sub with "Make planned subs". The Plan tab always shows the next subs at the top with "Make these subs now", so subs can be made early. Making them early means the sub alert won't go off again.
- "Turn off the plan" for a game means the coach chooses each sub; alerts still sound, and you tap bench players to line them up.
- Goals: + Goal for either side, then pick the scorer and assist. The minus button takes a goal off.
- Adjust (top bar): fix the clock to match the ref (−5:00 … +5:00, or type a time), add added time, or reset the game. Tap Done to close it.
- Undo (top bar) undoes the last sub.
- End game finishes the game. Ties can go to overtime or penalty kicks.
- Official result: after a game, "Confirm official result" locks the final score (from SincSports, GotSport, the ref, etc.). After that no phone can change the score. Any coach can lock a result; only the main code can change or remove one.

## Team setup (Setup tab)
- Team name, short name, subtitle, logo, goal song, rotation plan on/off.
- Format and formation: 7v7 up to 11v11, preset formations, or type any shape like 4-3-2-1 (numbers must add up to the field players). "Rename positions" changes the labels shown on the field.
- Players: add, rename, number, mark guest, positions. Remove players.
- Games: name, opponent, kickoff time, field, address (for the map link), tournament or event (or Friendly), half length, sub interval, opponent logo.
- "Fix a problem": restore an earlier version of a game (for example after an accidental reset or a lost goal) or of the team setup (after deleting a game or player by mistake). The current version is kept, so a restore can be undone too.

## Schedule tab
- Shows coming games, practices and events. Everyone can tap "Subscribe on this phone" (or Google Calendar, or Copy link) to get the team's schedule in their phone calendar; it updates on its own within about an hour.
- Families with kids on several teams: on the club page, Teams view → My calendar, tap each team, then subscribe once.
- Coaches: Add practices (days of the week, time, length, place, from/through dates, dates to skip), Add one event, Cancel/Restore a practice, Delete one, or "Delete this & later" for the rest of a series.

## Board tab (coaches; parents see shared plays as a Plays tab)
- Drag players, opponents, the ball and cones. Tools: Move, Run, Pass, Dribble, Shot, Draw, Erase. "Our lineup" places the team's formation with current names.
- Steps: + Step copies the current positions so you can move players for the next moment; ▶ Play animates through the steps.
- Save play, Share with the team (parents can then see it), New play. "Draw it for me" asks the AI to draw a play from a description.

## Coach tab (coaches): Coach the Coach
- Ask the AI committee a question. Three members answer in their own style and the chair writes a summary and practice plan. Members are fictional AI coaches inspired by schools of coaching, not real people. Tap members to choose who answers. Each team has a monthly limit of AI questions.

## Messages and fees (💬 button, bottom corner)
- Joining: coaches tap 💬 → Join as coach (on a team page they've unlocked). Parents open the invite link from their coach, enter their name and pick their player(s). Coaches make invite links under 💬 → Me → Invite parents.
- Channels: Club announcements (admins post, everyone reads), Club coaches (coaches and admins), each team's chat (that team's families and coaches). Direct messages: parents can message their team's coaches and parents; coaches can message each other; admins can message anyone. New message picks a person.
- Coaches and admins can remove messages in their team chat and pin a message. Everyone can remove their own messages.
- Fees (💬 → Fees): parents see what they owe for their player and can pay with the Venmo app (then tap "I paid with Venmo" so the coach can confirm) or with PayPal/Venmo checkout when it's set up (that adds a processing fee so the club gets the full amount, and marks it paid automatically).
- Coaches bill their team (New fee: type, what for, amount, due date, who pays, where the money goes). Admins can also bill the whole club and club dues. In a fee, set each player's status (Unpaid, Pending, Paid, Paid outside app, Waived) or a scholarship amount. "Nudge unpaid" sends a reminder message to parents who still owe. Export CSV downloads the list.
- Payment settings (Fees): each team manager and the club treasurer add their Venmo username and, optionally, their PayPal app's Client ID and Secret (from developer.paypal.com).
- Sign out on this device: 💬 → Me.

## Notifications and the Home Screen
- 💬 → Me → "Notifications on this phone" → Turn on notifications. Then choose what you get: team chat and direct messages, club announcements, new fees and reminders, kickoff and final scores, cancelled practices and events. "Send a test" checks it works.
- iPhone: notifications only work after adding the app to the Home Screen. In Safari tap Share (the square with the arrow), then Add to Home Screen, then Add. Open the app from the Home Screen icon and turn notifications on there.
- Android and computers: tap Turn on notifications and allow them when asked.
- "I'm not getting notifications": check they're on in 💬 → Me, that the phone's Settings allow notifications for the app, and (iPhone) that you opened it from the Home Screen icon. Turn them off and on again on that phone if needed.
- Tapping a notification opens the right chat, fee or game.
- Opening the app from the Home Screen takes a family with one team straight to that team.

## People (coaches and admins: 💬 → People)
- Pick a team. "Make invite link" gives a link to send families.
- Players and their families: each player shows the parents linked to them. "+ Link parent" links someone on the team to that player (for example a second parent, or a family who joined but didn't pick their player). × unlinks.
- Families on the team: shows who hasn't picked a player yet, and "Remove from team".
- Club admins also see "Everyone in the club": change someone's role (Parent, Coach, Club admin) or remove them (signs them out everywhere). Admins can link a parent from another team (siblings on two teams).
- Parents: 💬 → Me → My players shows your players and lets you add a sibling on the same team. For a player on another team, use that team's invite link.

## Common fixes
- "The score or clock is wrong": coaches use Adjust for the clock, + Goal / − for goals, or Setup → Fix a problem to restore an earlier version. A locked official result can only be changed with the main code.
- "A game or player disappeared": Setup → Fix a problem → restore the team setup from before it happened.
- "It says view only" / can't change anything: the device isn't unlocked. Enter the coach code on the team page.
- "My calendar didn't update": subscribed calendars refresh on the phone's schedule, usually within an hour. Make sure you subscribed (not downloaded once).
- "I paid but it says unpaid": Venmo payments are confirmed by the coach; tap "I paid with Venmo" so it shows Pending, and the coach marks it paid.
- "My invite link doesn't work": ask the coach for a new link (Me → Invite parents → Make link).
- "The app looks old": it updates itself; closing and reopening the page picks up the newest version.
`;
