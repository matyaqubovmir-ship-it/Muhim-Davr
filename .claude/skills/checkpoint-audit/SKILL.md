---
name: checkpoint-audit
description: "Run the Muhim Davr auditor checklist before a hackathon checkpoint, demo, or push: tests/lint/typecheck, live Realtime path, write-path constraints, secrets, zone-color accessibility, commit history, README AI section."
---

# Checkpoint audit — run before every checkpoint

Work through every item; verify each live rather than by reading code, and fix what fails before moving on. Report each item as pass/fail with the evidence.

- [ ] `npm run test:run`, `npm run lint`, `tsc -b` all pass.
- [ ] Does the registry/escalation queue show real data from Supabase, live — not mocked, not a static screenshot pretending to be live?
- [ ] Does a new `qizil` assessment or `ochiq` escalation actually appear on the specialist screen without a manual refresh (test the Realtime path live, don't assume it from reading the code)?
- [ ] Does submitting through `EntryForm` still work exactly as before (you must not have broken the existing, tested midwife flow while adding the specialist side)?
- [ ] Any new write path respect `assessments`' append-only trigger and `escalations`' status-timestamp constraint, or does it 500 against the database?
- [ ] Is every new scoring-relevant field covered by `schema-sync.test.ts`?
- [ ] Does the extraction fallback (form stays typeable) still work if you temporarily unset `ANTHROPIC_API_KEY`?
- [ ] Are secrets (`ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, any service role key) only ever in `.env.local`, never committed, never given a `VITE_` prefix?
- [ ] Do zone colors meet contrast requirements, and is zone status conveyed by more than color alone?
- [ ] Does the registry/escalation UI work on the actual laptop you'll demo from, not just in a quick resize of a dev-tools viewport?
- [ ] Is there a git commit history showing incremental work across both days, not one dump at the end (the organizers say they audit this)?
- [ ] Does the README's AI Design section accurately describe Layer 1 vs Layer 2, so a non-technical domain mentor could read it and understand the safety design?
