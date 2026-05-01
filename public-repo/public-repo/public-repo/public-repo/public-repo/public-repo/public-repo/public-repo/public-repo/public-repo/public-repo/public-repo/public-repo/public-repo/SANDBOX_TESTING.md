# Sandbox Testing Checklist (`feat/next-updates`)

Use this before promoting changes to `main`.

## 1) Confirm branch and sync

```bash
git checkout feat/next-updates
git pull --ff-only
git status -sb
```

Expected: clean status on `feat/next-updates`.

## 2) Start local relay API/WS (Terminal A)

```bash
cd relay
npm run start
```

Expected log includes `HTTP listening on :3000`.

## 3) Start local static site server (Terminal B)

From repo root:

```bash
python3 -m http.server 5500
```

## 4) Open local URLs

- Performer app: `http://localhost:5500/`
- Console app (forced to local relay):
  - `http://localhost:5500/console/?ws=ws://localhost:3000/ws&console_api=http://localhost:3000`

## 5) Smoke-test pass/fail checks

Pass if all are true:

- Host login works in console.
- Session creation works.
- Performer joins via invite link.
- Gesture updates appear in console (mouth and unmuted gestures).
- MIDI notes and CC routing behave correctly.
- No critical errors in browser console.

## 6) If PASS: publish sandbox branch

```bash
git add .
git commit -m "Describe update"
git push
```

## 7) Promote to production branch (`main`)

Open PR:

- Base: `main`
- Compare: `feat/next-updates`

Merge only after checklist passes.

## Optional: quick stop commands

If needed, stop local servers with `Ctrl + C` in each terminal.
