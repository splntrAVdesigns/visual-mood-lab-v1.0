# Visual Mood Lab v1.9 — two confirmed root causes, both fixed

```
npm install --ignore-scripts
npm run dev
```

After deploying: run `/api/seed` once. The board-item fix only takes effect
on a seed run, and your existing deployment needs that run to create the
cards it's currently missing.

---

## 1. "31 assets seeded, 18 on the board"

`lib/ingest/ingest.ts` had an early return for unchanged content:

```ts
if (prior && prior.contentHash === contentHash) {
  return { id: prior.id, created: false, unchanged: true, ... };
}
```

That return fired **before** `ensureCanonicalBoardItem`, which is called on
both other paths further down. Assets and board items are separate tables —
the board renders board items, not assets — so any asset whose content
hadn't changed since a previous run got its row updated and its **card never
created**.

Your seed output said it exactly: `unchanged: 30, total: 31`. Thirty assets
took the early-return path. Only the ones created back when their content
was still changing ever got cards, which is where 18 came from. Every
subsequent seed run would silently fail to surface anything already ingested.

Fixed by ensuring the board item on that path too.

**Verified specifically against the failing case:** seeded a fresh database,
then seeded again with everything reporting `unchanged: 30` — the exact
scenario that used to lose cards — and confirmed all sampled asset titles
still render on the server-rendered board.

## 2. Parameter edits reverting when reopening a tile

`stores/inspectorStore.ts` contained zero references to the board store.
Changing a parameter updated three things: the inspector's own state, the
live renderer, and the database. It never updated the board store — which is
what `openAssetById` reads when you reopen a card, and what the grid
thumbnail renders from.

So the value genuinely saved to Postgres, then got overwritten in the UI by
the stale copy still sitting in the board store. It only appeared to work
after a full page reload, since that is the one moment the store gets
refilled from the server. Closing and reopening the overlay never triggered
that.

This also explains the second half of the report — adjustments not showing
on the preview tile after backing out to the board. Same stale store, same
cause.

Fixed by syncing params and modulation into the board store on every change,
behind the same function that persists them, so the two can't drift apart
again.

## Still outstanding

Tiles not animating on the deployed build, and the "1/3" live indicator
never appearing. These are the same symptom — the indicator only renders
when a renderer is actually live — and I have not found the cause. The
persistence logging added in v1.8 stayed silent, which does rule out a
failing save as the explanation, so it is something in the promotion path
specific to production. Worth retesting after this deploy, since a board
that was missing most of its cards was not a clean environment to diagnose in.

## Queued, not started

- +20 assets (50 total)
- Strange Attractor rework — sliders don't meaningfully change the visual
- Cube Transform rework — too plain
- Mobile layout phase
