# Tracker

A static site (`index.html`, `style.css`, `data.js`, `qdata.js`, `app.js`) plus one small serverless function
(`api/data.js`) that syncs your progress between devices. Without the function it still works, saving to the
current browser only.

## Deploy on Vercel (about 5 minutes)

1. Put this folder in a GitHub repo (or run `vercel` from inside it). `index.html` and the `api` folder must sit
   at the **top level** of the project. Framework preset: **Other**. No build command, no output directory.
2. In the Vercel project open **Storage**, create or connect **Upstash Redis** (free plan is plenty) and connect
   it to this project for all environments. Button wording changes now and then, but the goal is the same: the
   project ends up with a REST URL and a REST token as environment variables. The function recognises
   `KV_REST_API_URL` + `KV_REST_API_TOKEN`, `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`, and the same
   names with a custom prefix. If none appear, add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
   yourself using the **REST** URL and token from the Upstash console (not the read-only token).
3. **Settings -> Environment Variables**: add `APP_PASS` (a long password) and optionally `APP_USER`.
4. **Redeploy** (Deployments -> the latest one -> Redeploy). Environment variables only apply to new deployments.

## Check that it works

Do these in order. Each one rules out a different problem.

1. **Function and Redis.** Open `https://YOUR-APP.vercel.app/api/health` in a browser. You want JSON that contains
   `"configured":true` and `"reachable":true`. If you see a web page, a login screen, or a 404 instead, see the
   table below.
2. **Sign in** on the site. The chip in the top right should change from "Syncing..." to **Synced**.
3. **Settings -> Check my setup -> Run checks.** Every row should say OK. It tests the function, the Redis
   connection, a real write and read-back, your login, whether you are still on the default password, and whether
   this device and the cloud hold the same number of entries.
4. **Two-device test.** Log something on your phone, then open the site on a laptop (or press the chip to sync).
   The entry should appear. Then delete it again.
5. **See the data.** In the Upstash console, Data Browser, there should be keys `gate-tracker:v3:state` and
   `gate-tracker:v3:rev`.

### If something is wrong

| What you see | Cause | Fix |
| --- | --- | --- |
| `/api/health` shows a Vercel login page | Deployment Protection is on | Project -> Settings -> Deployment Protection: turn off Vercel Authentication, or use your production domain, not a preview link |
| `/api/health` is a 404 | `api/data.js` is not at the project root of the deployment | Move it so `api/data.js` sits next to `index.html`, redeploy |
| `"configured":false` | No Redis variables on this deployment | Connect Upstash to the project (all environments), then redeploy |
| `"reachable":false` | Wrong URL or token | Copy the REST URL and token again from the Upstash console |
| `"canWrite":false` | Read-only token | Use the normal REST token |
| Chip says "Offline" or "This device only" | The checks above are failing | Run Settings -> Check my setup, fix the red rows, press Sync now |
| Signed out right after changing `APP_PASS` | Old password saved in the browser | Sign in again with the new password |
| "too many attempts" | 10 wrong passwords from one network in 15 minutes | Wait 15 minutes |

Local-only fallback: if the function cannot be reached, the app keeps working and saving in this browser, and
syncs the next time it can. Settings -> Export backup downloads a JSON copy any time. Take one now and then.

## What changed in this version

- **Exact pages for every question.** `qdata.js` holds the book page and the exam name of all 3,817 questions, generated from the question directory. Logging by page and by
  question now agree exactly instead of using an even-spread estimate. The log preview and the Subjects tab name
  the exam question a number refers to, and Subjects has a "Find a question" box to look up a question by its exam
  name. If you edit a book's numbers on the Subjects tab, that book falls back to the old estimate.
- **Safer sync.** Writes are atomic (two devices saving at the same instant can no longer lose one write), the
  server limits wrong-password guesses, and existing data from the earlier storage format is migrated
  automatically.
- **Setup check** in Settings and a `/api/health` endpoint.
- **Exam date note** updated: IIT Madras lists GATE 2027 on 6, 7, 13, 14, 20 and 21 February 2027 (dates are
  liable to change). The default is the first day; set your own paper's date.

## Other notes

- Your data is one JSON blob in Redis. If two devices edit at once, the newest save wins for settings and plans,
  and log entries from both are merged.
- **Edit numbers:** Subjects tab, "Edit numbers for this book". "Reset to PDF defaults" undoes it.
- **Targets that carry forward:** plan a day with blocks and a checklist; anything unfinished shows up the next day
  and can be carried over with one click.
- **Regenerating `qdata.js`:** `node tools/build-qdata.js path/to/GATE_PYQ_Complete_Question_Directory.md`. It
  cross-checks the directory against `data.js` and refuses to write if anything disagrees.
- **Tests:** `cd tests && npm install && npm test` (needs Node 18+). They cover the page/question mapping for all
  books and topics, the API (including concurrent writes, migration, lockout), and two simulated devices syncing.
