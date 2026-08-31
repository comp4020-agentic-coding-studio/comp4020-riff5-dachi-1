# You are riffing on someone else's prototype

This repo is a copy of [`comp4020-crit5-dachi`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-dachi) at
`710c2d86` --- dachi's crit agent's shipped prototype for `05-game`.
The copy is yours; their repo is untouched and off limits.

**The brief is to take this somewhere it hasn't been.** Not to restart it, not
to polish it, and not to finish the agent's to-do list. Read how they directed
the agent, find the thing the prototype implies but doesn't do, and build
that. You have the session's half-hour, so pick something you can get live.

**Nothing here is marked.** No cutoff, no reflection, no `PROCESS.md` entry,
no crit sweep, no repo of your own on the line. That is the point --- the
interesting move is the one you wouldn't risk in your own graded repo.

**What you show at the share-back** is the live site plus
`git diff riff-start`. Push early and keep `main` green.

**The agent's own spec tests are `spec/game-logic.test.ts`.** They encode the crit brief,
not yours, and they gate the deploy --- a red check means no live site to show
at the share-back. If your riff moves past that brief, change them or delete
them; keep `spec/invariants.test.ts` green, since that one is true of any good
site.

Everything below this line was written for that crit submission. The marks,
the cutoff, the private-repo phase, the weekly `start` skill and the
reflection are all done, and none of it governs what you do here. Read it for
how they worked, not for what you owe.

---

# COMP4020 prototype

Your starter repo for a COMP4020 prototype: a static site in HTML/CSS/TypeScript
that builds to plain HTML/CSS/JS and deploys to GitHub Pages. The deployed site
is what gets marked, not this repo.

The
[course website](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/)
publishes this deliverable's brief and spec, and this repo's name tells you
which deliverable applies. Read both before you plan or build.

## The link-preview card

`public/card.png` (1200x630) is the image a shared link shows; `index.html`'s
head points at it. Replace it and the `description` meta, and copy the head
block into any new page. The card URL resolves against the page that names it,
like any link --- `./card.png` is wrong one directory down, and nothing in CI
checks it, so the deployed head is the only place a broken one shows up.

## The checks

`pnpm check` runs them, and `pnpm check:evidence` is the extra gate before you
ship. CI runs the same plus links, secrets and the deploy.

`spec/README.md`, `PROCESS.md` and `reflections/README.md` are in this repo and
say what they are for.

## Swerve-specific notes

- The canvas is a fixed logical resolution (300×500 world units in `main.ts`)
  scaled via `canvas.style.width/height` to fit the viewport, letterboxed
  rather than redrawn per-viewport. All gameplay math (lane centres, row
  speed, collision) stays in world units; only `resize()` touches CSS pixels.
  Confirmed correct at both marking viewports, at a 320px reflow check, and
  across a resize mid-round (lane position survives). Reuse this pattern
  directly for any future canvas-based prototype rather than re-deriving it.
- `game-logic.ts` has no DOM/canvas/timers so the one rule the brief requires
  under test (`isCollision`) --- plus the fairness invariant it depends on
  (`generateRow` never blocks every lane) and the difficulty/speed ramps --- is
  a plain unit test, not a DOM-wired one. Keep new rules in this file, not
  `main.ts`, for the same reason.
- To playtest pacing/feel (not just correctness) without shipping debug code,
  temporarily append `(window as any).__debug = () => ({ ...state })` after
  `main.ts`'s final `requestAnimationFrame(frame)` call, drive real input via
  `agent-browser press`, poll the probe to react and to log score/timing, then
  `git checkout -- main.ts` before committing. Confirmed the difficulty ramp
  (blocked-lane count climbs to score 40, speed climbs to score 75 then caps)
  reads as a well-graduated skill curve, not a cliff, and that dying clears
  the board and gives a fresh ~4s runway before the next threat --- restarting
  immediately on any key feels cheap in the encouraging sense, not the unfair
  one. A single scripted death around score 23 during this pass was very
  likely CLI round-trip latency outrunning the reaction window at higher
  speed, not a fairness bug --- the "never blocks every lane" invariant is
  already unit-tested, so treat an automated-play death at high difficulty as
  a tooling artefact to double-check, not a bug report, unless the debug
  probe's own state shows an unsafe row (all three lanes blocked).
- The keydown handler binds bare `a`/`d`/arrow keys and called
  `preventDefault()` unconditionally, which hijacked real browser shortcuts
  sharing those keys with a modifier held --- confirmed with a real
  `agent-browser press Control+a` / `Alt+ArrowLeft` and a bubble-phase
  listener reading `event.defaultPrevented` back (`true` before the fix).
  Fixed with a one-line guard (`if (e.ctrlKey || e.metaKey || e.altKey)
  return;`) at the top of the handler, re-confirmed clean after. Any future
  keyboard-driven prototype that binds letter or arrow keys globally needs
  this same guard checked, not assumed --- it's cheap to add up front but
  easy to miss since it only shows up against a real modifier combo, never
  a plain keypress.
- `preventDefault()` on a bare, unmodified key that does nothing yet (Space,
  before game-over) is just as easy to miss as the modifier case above ---
  the keydown handler only called it for Space/Enter when `gameOver`, so
  pressing Space mid-round fell through to the browser's default scroll.
  Invisible at both marking viewports (the page never overflows there), but
  `resize()`'s own 0.5 minimum scale floor means a short-enough viewport
  *does* leave the canvas taller than the window, and Space visibly
  scrolled the canvas out of view mid-game. Confirmed with a real
  `agent-browser press Space` plus `window.scrollY` at a forced-overflow
  390×250 viewport, both before (`98`) and after (`0`) the fix
  (call `preventDefault()` for Space/Enter unconditionally, gate only the
  `resetGame()` call on `gameOver`). General lesson: when auditing a keydown
  handler for browser-default leaks, don't stop at "does it guard the right
  modifiers" --- also check whether it calls `preventDefault()` on every
  branch a key can take, including the ones where the game itself does
  nothing, and check it at a viewport where the page's own layout invariant
  (here, "canvas always fits the window") is actually forced to break.
- The canvas's `pointerdown` handler moved or restarted the player for any
  mouse button, since it never checked `e.button` --- a right-click silently
  steered the player (or restarted a finished round) exactly like a
  left-click, while the browser's own context menu still opened on top of
  the result. The mouse-button analogue of the modifier-key keydown lesson
  above: any pointer handler bound to a whole interactive element (not just
  a keyboard handler bound to a whole keyboard region) needs to check which
  input variant actually triggered it before treating them as equivalent.
  Confirmed two ways: a real CDP `agent-browser mouse down/up right` on the
  canvas (proving the OS/browser genuinely dispatches `pointerdown` with
  `button: 2`, not just a hand-built event) and a synthetic
  `dispatchEvent(new PointerEvent('pointerdown', {button: 2, ...}))` via
  `agent-browser eval` to sidestep this sandbox's CLI round-trip latency
  outrunning the ~5s-from-load reaction window (see the debug-probe entry
  above) --- reading `#live`'s text back showed a right-click left a
  game-over announcement untouched (no `resetGame()`) while an immediately
  following left-click still blanked it (restart still works), and
  pixel-read the player's lane to confirm a live-round right-click doesn't
  move it either. Fixed with `if (e.button !== 0) return;` at the top of
  the handler --- safe for touch/pen too, since the Pointer Events spec
  mandates `button === 0` for any primary-contact pointerdown regardless of
  device. General lesson: this is a distinct check from the touch-action
  and multi-touch-tracking passes already run on this project --- test the
  *button* field on a pointerdown handler specifically whenever the handler
  drives game state from a whole-element listener, not just whether touch
  and mouse are both wired up.
- The global keydown handler's unconditional `preventDefault()` on Enter (to
  gate restart-on-game-over) also ate Enter for the header's own `Home` link
  --- a keyboard user tabbing there and pressing Enter got nothing, since the
  handler never checked what actually had focus. Distinct from the modifier-
  key and pointer-button lessons above: those guard against a different
  *input variant* on the same target; this one guards against the *same
  input* landing on a *different* target the page also makes focusable.
  Confirmed with `agent-browser`: attach a `click` listener on the nav
  anchor, real `press Tab` then `press Enter`, read the listener's flag back
  --- `false` (never fired) before the fix, `true` after. Fixed by checking
  `e.target` against a `closest("a, button, input, select, textarea")`
  guard at the top of the handler, before the key-specific branches; re-
  confirmed arrow-key movement and the Space-scroll fix both still work
  unfocused (target is `body`) and canvas-focused. General lesson: any
  global keydown handler that binds keys page-wide (not scoped to one
  element) needs this guard the moment the page grows *any* other
  focusable element (a link, a button) --- it's invisible until something
  else on the page becomes tabbable, which a single-page prototype with
  just a canvas can go a long way without noticing.
- Eighth run: three sensor angles all confirmed clean, no new bug. A full
  `Tab`/`Shift+Tab` walkthrough (Home link → canvas → nothing, and back) is
  sane now that the focus-stealing Enter fix above has landed. Middle-click
  (button 1) on the canvas, tested both live-play (via a debug probe reading
  `playerLane`) and game-over (dispatched a real synthetic `PointerEvent`
  with `button: 1` in both states), doesn't move or restart --- the
  `e.button !== 0` guard already covers it, not just left/right as the prior
  hand-off left unconfirmed. A fresh `agent-browser a11y --json` run reports
  0 violations, 0 incomplete. None of these need re-running unless the
  keydown handler, the pointerdown handler, or the page's focusable-element
  set changes again.
- Ninth run: a genuinely new angle, not another input-handling-family check.
  A `<canvas>` with an accessible name but no explicit `role` gets the
  implicit HTML-AAM role `img` --- confirmed via `agent-browser eval
  "document.querySelector('canvas').getAttribute('role')"` reading `null`
  (axe doesn't flag this; it's outside axe's rule set, not a WCAG violation).
  That matters here specifically because every move in Swerve is a bare
  arrow key delivered by a `window`-level `keydown` listener: a screen
  reader's browse-mode virtual cursor (NVDA/JAWS) claims arrow keys for its
  own quick-navigation by default, and only stops doing so for elements
  whose role puts the AT into focus/forms mode --- a generic `img`-role
  focusable element doesn't trigger that, so a blind screen-reader user
  tabbing to the canvas could have every arrow-key press consumed by their
  AT's navigation instead of ever reaching the game. Unlike the single-
  letter-hotkey-vs-quick-nav collision logged for Aurora Keys in the global
  `MEMORY.md` (not treated as blocking there, because buttons gave an
  independent accessible path to the same functionality), Swerve has no
  alternate control --- arrow keys are the only way to move, so this isn't
  a redundant-input-path question, it's a can-a-screen-reader-user-play-at-
  all question. Fixed by adding `role="application"` to the canvas, the
  standard technique for a canvas game that needs raw keystrokes handed
  straight to the page rather than intercepted for content navigation.
  Verified what's actually checkable in this environment (no real
  NVDA/JAWS/VoiceOver available to confirm AT behaviour directly): `pnpm
  check` still green, a fresh `agent-browser a11y --json` still reports 0
  violations/0 incomplete with the role present, and a real `agent-browser
  press ArrowRight`/`ArrowLeft` sequence (patching
  `CanvasRenderingContext2D.prototype.arc` via `eval` to read back the x
  argument each draw, since the game's position lives in a closed-over
  `main.ts` variable with nothing to query in the DOM) still moves the
  player between lane centres (150 → 250 → 50) exactly as before the
  change --- confirming the fix is additive for AT semantics and doesn't
  touch the working keyboard path for sighted/mouse users. Worth treating
  the implicit-role check as a standard question for any future canvas- or
  div-based interactive prototype bound entirely through global keyboard
  listeners, not just Swerve.
- Tenth run closed the ninth run's open question and added a genuinely new
  check, both confirms rather than bugs. First: whether `role="application"`
  on the canvas could suppress the `<p id="live">` `aria-live="polite"`
  announcement, since application mode can pull an AT into a mode where it
  reads only what the app hands it. Answered decisively rather than by
  reasoning alone --- `agent-browser eval
  "document.querySelector('#game').contains(document.querySelector('#live'))"`
  reads `false`: the live region is `#game`'s sibling inside `<main>`, not a
  descendant, so it sits outside the DOM subtree application mode actually
  scopes to. No code change needed; the existing narrow scoping (role only on
  the canvas, not a wrapping container) already keeps the two independent.
  Second: real touch input on the canvas had never been exercised directly
  --- every prior pointer test used mouse buttons 0/1/2. Since `agent-browser`
  has no CLI-level touch primitive outside an unavailable `-p ios` provider,
  used the project's own temporary-debug-probe technique
  (`(window as any).__debug = () => ({ playerLane, score, gameOver })`,
  appended then `git checkout -- main.ts` after) plus a synthetic
  `PointerEvent` with `pointerType: 'touch'` dispatched straight at the
  canvas. A tap on the right half moved `playerLane` from 1 to 2, and a tap
  after a natural game-over reset `gameOver`/`score`/`playerLane` and cleared
  `#live` --- confirming the `pointerdown` handler (which never branches on
  `pointerType`) genuinely works for touch, the primary input at the 390×844
  marking viewport, not just for the mouse/keyboard paths already verified.

- Eleventh run examined a genuinely new question --- does the START_GRACE_PX
  spawn delay (added after a prior playtest found the very first row reached
  a fresh-load stranger only ~3s in, "tight... before a first-time player had
  even worked out which key does what") survive a restart, or does dying once
  put the player straight back into that tight timing? `resetGame()` sets
  `spawnAccumulator = 0`, not `-START_GRACE_PX` --- only the very first load
  gets the grace. Confirmed the real timing gap with the project's own
  temporary-debug-probe technique (`(window as any).__debug = () => ({...})`
  appended after `main.ts`'s final `requestAnimationFrame(frame)` call, then
  `git checkout -- main.ts` to revert, confirmed clean via `git status` and a
  rebuild matching the pre-probe asset hashes): standing still in lane 1 from
  a fresh load, the first row reaches the collision line at ~4.99s; doing the
  same immediately after a restart, at ~4.19s --- about 0.8s less runway,
  closer to the original ~3.05s problem than to the ~5s fix. Deliberately
  **not** treated as a bug to fix: the grace period's own stated purpose was
  onboarding a stranger who hasn't yet worked out the controls, and by the
  time a player has died once they have --- the brief's five-minute/no-
  tutorial bar is about first encounter, not about every subsequent life
  getting the same runway. A scoped-out, reasoned decision, like the ninth
  run's non-visual-playability call in the global `MEMORY.md` --- don't
  reopen this as a gap without a concrete reason a repeat-life stranger is
  actually struggling (e.g. cold-play evidence from the pod crit), since the
  design intent (grace once, not forever) is deliberate, not an oversight.

- Twelfth run applied two standard, once-per-project sensors documented in
  the global `MEMORY.md` that had never actually been run against this
  project specifically (both were run on assignment 1 and/or Aurora Keys,
  but not Swerve): the 320 CSS px reflow check and a Navigation Timing /
  transfer-size read. Both came back clean. `agent-browser set viewport 320
  690` plus `document.documentElement.scrollWidth === innerWidth` held both
  at rest and mid-play (a real `ArrowRight`/`ArrowLeft` press between reads,
  not just a static load) --- the fixed-resolution canvas's own scale-down
  logic in `resize()` already handles the narrowest realistic viewport, not
  just the two marking ones. `performance.getEntriesByType('navigation')`
  showed an 8.3ms load; the whole build (HTML+CSS+JS) is a few KB
  uncompressed, well under any realistic slow-connection throttle by size
  alone, no images/fonts to worry about. Neither check needs re-running
  unless `resize()`'s scale logic or the build's dependency footprint
  changes. This makes four consecutive runs (9, 10, 11, 12) producing only
  confirms or reasoned scope-outs, not new bugs --- a strong signal the
  input-handling and layout sensor families are both genuinely exhausted
  for this project, not just quiet for one run.
- Thirteenth run asked a fifth new question --- does a backgrounded tab's
  rAF throttling (a long real-world gap between frames when a player
  alt-tabs away and back) let a stale `dt` cause an unfair jump, either a
  single huge collision check or a burst of rows spawning at once --- and
  answered it by arithmetic rather than a live browser check, since the
  bound is explicit in the code, not something that needs observing.
  `frame()`'s `dt` is clamped to `Math.min(0.05, ...)` regardless of the
  real elapsed time (`main.ts:138`), and even at the game's own top speed
  cap (`speedForScore` maxes at 9, `* SPEED_SCALE` = 450 world units/s),
  one clamped frame only ever advances `spawnAccumulator` by 22.5 units
  --- well under `ROW_SPACING_PX` (170), so the `if` (not `while`) spawn
  check in `update()` can never silently skip a multi-row burst either.
  Both bounds are checkable by reading the constants and doing the
  multiplication, the same kind of confirm as assignment 1's "is this
  branch actually reachable" `node -e` repros --- no `agent-browser`
  round-trip needed when the invariant is a literal numeric clamp, not
  DOM/timing behaviour a script has to observe. This makes five
  consecutive runs (9--13) producing only confirms, no new bugs, at 65.5h
  to cutoff (~61% of the 168h window elapsed) --- past this run drafted
  `reflections/crit-5.md` rather than inventing a sixth pass, per the
  doctrine's own working-style precedent (assignment 1: draft evidence
  early once sensors are genuinely dry and most of the week has already
  elapsed, rather than waiting for the last day or forcing another
  re-verification pass).
- Fourteenth run closed a gap between this file and the global memory: an
  earlier check --- whether the player marker's idle pulse animation
  actually stops under `prefers-reduced-motion: reduce`, not just narrows
  --- had been run and its result written to the cross-project
  `MEMORY.md`, but never landed here or in a commit. Canvas draws to a
  bitmap, so `getComputedStyle` (the sensor for animated CSS custom
  properties) has nothing to read; the equivalent move is monkeypatching
  the actual draw call. Re-confirmed live rather than trusting the
  unlogged memory entry at face value: loaded `dist/` fresh, forced
  `prefers-reduced-motion: reduce` *before* the page's own module-load-time
  `matchMedia` read (main.ts:28), wrapped `ctx.arc` via `agent-browser eval`
  to log every radius passed to it across ~1.3s. Reduced-motion produced 1
  distinct radius (`20`) across 81 draws; the default state produced 81/81
  distinct values. Confirms the `!reducedMotion` guard at main.ts:109
  disables the pulse outright rather than just damping it. No code change
  --- a confirm, like runs 8, 10, 12 and 13. General lesson: when a
  cross-project memory entry names a specific numeric result for *this*
  project but this file has no matching run entry or commit, don't assume
  it was already landed --- re-verify live and write it down here too,
  since the global memory file isn't the record a marker or a future run
  of this repo actually reads.

## This file is yours

A starting point, not a rulebook: what you add to it is the harness, and the
harness is assessed. This file and the sensors you wire into `check` carry
across the course --- both come with you into next week's repo. The prototype
doesn't: source, and the tests answering this week's published spec, stay
behind. `spec/README.md` draws the line.
