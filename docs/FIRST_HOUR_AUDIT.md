# First-hour new-player audit

`scripts/first-hour-audit.mjs` signs up a commander on a local production build and plays the first session without grants or clock skips. Universe speed stays the server default (8). The walk is phone width 390×844, then the same commander is checked again at 1280×800. It claims the three starter buildings, builds a Deuterium Extractor, a Research Lab, Power Discipline, and a Shipyard, builds a Recon Drone and a Spy Satellite, opens Galaxy from the briefing, and opens the fleet review without sending.

The first run recorded the friction below. This change fixes only the copy that was already wrong. The other items stay proposals.

## Fixed in this change

| Symptom | Evidence from the scripted run | Change |
| --- | --- | --- |
| Ore Mine, Solar Array, and Crystalizer are already level 1, but each row said "Raise … to level 1" and the status was "Ready". | `step:metalMine1`, `step:solarPlant1`, `step:crystalMine1`: `status=Ready completed=true` and copy beginning "Raise … to level 1". Claims still paid (metal 500 → 2600, crystal 500 → 1400). | Status is "Ready to claim". A hint says "Already done. Claim the reward." The progress line counts unclaimed rewards. The level rule in `ONBOARDING_STEPS` is unchanged. |
| Recommended next told a commander with no lab to unlock Shadow Optics. | `recommended-next`: "Recommended next: raise the Research Lab, then unlock Shadow Optics." On Research, Shadow Optics was "Needs lab 3" while Power Discipline was "Needs lab 1". | The hint now says to start Power Discipline, which is the research the lab can run. |
| After the lab, the same hint said "Scout / Probe". | `recommended-after-lab`: "Recommended next: raise the Shipyard (then bank a Scout / Probe)." The shipyard row title was "Recon Drone". | The hint names Recon Drone and Spy Satellite. The no-hull line does too. |
| The fleet example said "1 scout". | `fleet-hint`: "Example one-way ETA ~11s · fuel ~1 deut (1 scout)." | The example says "1 Recon Drone" (`data-testid="fleet-orbit-hint"`). |

## What the walk could finish

Join showed `3 / 8 complete` with claim buttons on the three starter steps. Goals, after those claims, listed `deutSynth1` and kept `next-goal` `building:researchLab`. The extractor upgrade was enabled. Power Discipline could be started only after the lab finished, and it reached level 1. The Shipyard, Recon Drone, and Spy Satellite were built from the buttons on those pages. Look outward became claimable because the Spy Satellite counts. After those claims the progress line was `7 / 8 complete`. Galaxy opened from that step (`Scan system (probes)`, `Send max expeditions`, deep space `1:1:16`). Fleet presets hid Moon Destruction and Mini Planet Destruction. Entering 1 Recon Drone enabled Next. The review opened on Station / Deploy and was not sent. Colony foundation stayed open. Phone and desktop had no horizontal overflow on the checked pages. No page errors. The confirmation run's progress line on join was `3 / 8 complete · 3 ready to claim`, and each starter row status was `Ready to claim` with the hint "Already done. Claim the reward."

## Proposals

These were not implemented.

### B7-70-P1 — Claim buttons start below the phone fold

Symptom: on 390×844 the three Claim reward buttons are not in the first screen.

Evidence: `step:metalMine1`, `step:solarPlant1`, and `step:crystalMine1` each recorded `claimInView=false` before any scroll. The resource bar and the wrapped page links sit above the briefing.

Follow-up: shorten the existing mobile nav so this briefing starts on the first screen. Do not add a second tutorial.

### B7-70-P2 — The briefing, the optional next step, and Overview disagree

Symptom: three different "next" lines are on Overview at once.

Evidence: `competing-next` — the highlighted briefing step was `deutSynth1` (Deuterium Extractor), `next-goal` was `building:researchLab` ("Power Discipline needs Research Lab level 1 (best lab 0)."), and the recommended line pointed at the lab as well. After the copy fix the recommended line matches the optional next step. It still does not match the highlighted briefing step.

Follow-up: decide whether the highlighted briefing step should follow `nextGoalSuggestionFor` or stay on the extractor. That is a tutorial change, not a copy correction.

### B7-70-P3 — The highlighted extractor spends energy the homeworld was balancing

Symptom: the next briefing build is the one that puts the colony into an energy deficit. The buildings footer only says to raise the Solar Array if mines stall.

Evidence: the home slot varies, and the extractor adds energy use without adding production. Joins recorded `44 / 44 Factor 100%`, `37 / 44 Factor 84%`, `30 / 44 Factor 68%`, and `24 / 44 Factor 55%` (the last three with `class=res energy deficit`). After the extractor those deficit runs read `37 / 84 Factor 44%`, `30 / 84 Factor 36%`, and `24 / 84 Factor 29%`. Produced energy did not rise. The buildings footer stayed "One construction at a time. Upgrade the Solar Array if mines stall." The highlighted briefing step was still the extractor.

Follow-up: say, on the extractor row or the briefing step, that it draws energy, or highlight Solar Array level 2 first. Do not change production numbers unless that follow-up asks for it.

### B7-70-P4 — Fleet Next stays off until a count is typed

Symptom: hulls in orbit are not enough. Next is disabled until the player types a count.

Evidence: `fleet-next-before-count` was `disabled Select at least one ship.` with a Recon Drone and a Spy Satellite already in orbit. Typing 1 enabled the review.

Follow-up: consider starting the count at 1 for the first hull in orbit. Leave send as a separate confirmation.

### B7-70-P5 — Daily claim sits above the briefing

Symptom: the first reward button on the screen is the daily login claim, not the briefing.

Evidence: `resource-bar` was `Claim daily +15 +res` before the commander briefing was read.

Follow-up: decide whether that button should wait until the briefing is dismissed. It is an existing reward, not a broken control.

### B7-70-P6 — Starter step sentences still describe a build the homeworld already has

Symptom: after the claim hint, the rule text is still "Raise an Ore Mine to level 1 on any world you own." A save that really is at level 0 needs that sentence. A brand-new homeworld does not.

Evidence: the same step rows that were `completed=true` still showed the raise-to-level-1 sentence. `joinUniverse` sets Ore Mine, Crystalizer, and Solar Array to 1. This matches the open question already in `docs/FEATURE_MAP.md`.

Follow-up: separate starter copy, or an auto-claim, only if old level-0 saves keep the current rule. Not done here.

### B7-70-P7 — Galaxy offers Send max expeditions on the first visit

Symptom: Look outward opens Galaxy, and that page includes Send max expeditions next to Scan system (probes).

Evidence: `galaxy` recorded `scan="Scan system (probes)"` and `maxExpeditions="Send max expeditions"` on the first Galaxy open.

Follow-up: decide whether Send max expeditions should wait until one expedition has resolved. The scan button can stay.

### B7-70-P8 — Buildings footer says one construction at a time

Symptom: the footer is stricter than the queue.

Evidence: `buildings-hint` was "One construction at a time. Upgrade the Solar Array if mines stall." The building queue base length is 2, so a second job can wait.

Follow-up: change the footer to say one construction runs at a time and another can wait in the queue. The audit walk never filled the queue, so this stayed a copy proposal.
