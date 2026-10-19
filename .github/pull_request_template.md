<!-- Title: [#<issue>] short summary. Open as a draft until the proof is complete. See AGENTS.md. -->

Closes #<!-- issue number -->
Linear: STA-<!-- n -->

**Tool used:** <!-- jules / opencode / antigravity / codex / copilot / grok-build / coding-bot -->
**Branch:** `agent/<tool>/<issue#>-<slug>`, rebased on `main` at <!-- sha -->

## What changed
<!-- One line per file you changed. -->
- `path/to/file.ts`: 

## Tests run (paste real output, Node 22)
- [ ] `npm ci`
- [ ] `npm test`: <!-- each suite with pass/fail counts -->
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] New or changed behavior has a unit test
- [ ] Server or save changes: old-save fixture loads unchanged; D1 query count within budget (≤ 20 per request, ≤ 40 per scheduled run)
- [ ] UI changes: checked at phone and desktop width (note or screenshot)

## Could not verify
<!-- Anything you did not or could not check. "None" if none. -->

## Found, not fixed
<!-- Other bugs you noticed. Don't fix them in this PR. -->

<!-- Never merge or deploy. Micah approves every merge and deploy. -->
