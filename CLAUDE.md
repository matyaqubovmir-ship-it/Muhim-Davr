# Muhim Davr — perinatal risk registry (Xorazm AI Xakaton, Problem #9)

> Product name: **Muhim Davr**. The codebase's internal package name, some file/table naming, and older comments still say "ONA" (an earlier working name) — that's fine to leave as internal naming, it costs nothing. What matters is that every user-facing string (the app title, the Telegram bot's own messages if it ever names itself, the README, the pitch deck) says **Muhim Davr**, consistently, everywhere a judge or a patient sees it.

The original build brief (gap analysis, screen specs, design spec, execution plan, open questions) is kept verbatim in `docs/build-brief.md`. It is now implemented — read the code for current state, and the brief only for original intent. The pre-checkpoint auditor checklist and the pitch notes live in the `checkpoint-audit` and `pitch-prep` skills.

**Do not start a new project. Do not change the stack.** Before declaring anything done, run all three: `npm run test:run`, `npm run lint`, `tsc -b`.

## The problem (Problem #9, official hackathon brief)

> *"Homilador ayollar va chaqaloqlar salomatligi tuman darajasida real vaqtda monitoring qilinmaydi: tahlillar yomonlashsa, OvaBMU mutaxassislari kech xabar topadi, yuqori xavfli holatlar oʻz vaqtida aniqlanmaydi."*

Plain English: at district level, pregnant women's and infants' health isn't monitored in real time. When a patient's results worsen, the district maternal-and-child-health specialists (**OvaBMU**) find out too late.

## The core design rule — never violate it

> **The model never decides urgency, never chooses a date, never picks a medicine, and never invents a value it wasn't told.** Every file that touches the AI says this explicitly in its header comment. The risk zone comes only from `scoreAssessment`. The visit schedule comes only from `generateSchedule`. Danger-sign urgency comes only from the fixed list in `danger-signs.ts`. Protocol reminders are a static array, never generated. The model's only job anywhere in this system is to read what a person already said and report it back as structured data.

When you build the new specialist-facing UI in section 4, this rule extends to it: an AI-generated summary sentence on the escalation queue (if you add one) must be built the same way — extractive, sourced from `fired_factors` and the assessment row, never a free-generated clinical opinion. If you're unsure whether something you're about to build violates this rule, it does; find the version that doesn't.

The model is called only from the server-side endpoint (`api/extract.ts`, also served locally by the Vite middleware) — never from the browser. The Telegram bot (`bot/`) is the patient's entire interface — she has no app.

## Design decisions the code alone won't tell you

- Never hardcode a list of Uzbekistan's provinces or districts. The district list comes from `select distinct district from patients`, so the registry is always honest about actual coverage.
- `latest_assessment_per_pregnancy` (migration 005) is the single source of "current zone" — do not duplicate "latest assessment per pregnancy" logic anywhere else.
- The escalation queue stays global and non-geographic on purpose — a specialist should not have to click through geography to see who's in crisis right now.
- The role switch is non-authoritative (it only changes which routes/nav items show) — never treat it as a security boundary; anonymous sign-in is a documented hackathon stand-in.
- Telegram alerts to specialists keep `broadcast.ts`'s dry-run-by-default caution — an alert channel that can spam a real doctor's phone during testing is worse than not having one.
- `ZONE_COLORS` in `src/lib/labels.ts` is the runtime source of truth for zone color; the `--color-zone-*` tokens in `src/index.css` must stay numerically identical — never update one without the other.
- Never rely on color alone for the zone — pair the badge with the word (`ZONE_NAMES`) and a distinct icon shape. Check WCAG AA contrast for every zone-color pairing you introduce, don't eyeball it.
- Bundle fonts with the app — don't depend on a CDN at the venue.

## Copy discipline — follow the existing split, don't blur it

This codebase already enforces a hard separation: **`src/lib/labels.ts` is clinician-facing copy** (can show a score, a factor list, a zone) and **`bot/messages.ts` is patient-facing copy** (never diagnoses, never reassures, never names a condition). Every new string you write goes in exactly one of these files, following its existing rules — do not write a new patient-visible string outside `bot/messages.ts`, and do not casually reuse a clinician-facing string on anything a patient might see. All UI copy stays in Uzbek (Latin script), matching what's there.

## Non-functional / safety checks specific to this codebase

- Never add an `UPDATE` or `DELETE` path against `assessments` from the new UI — the database trigger will reject it, and if you find yourself wanting to, the append-only design is telling you to write a new assessment row instead.
- Any new scoring-relevant field must be added to `risk.ts`'s `SCORING_INPUT_FIELDS`, the migration, *and* checked against `schema-sync.test.ts` — don't add a column the scorer can't see or a scoring input with nowhere to live.
- Any new escalation-status transition must satisfy `escalations_status_timestamps` — write the acknowledge/close actions as the only two mutations, matching the four states already defined (`ochiq`/`qabul`/`yopiq`/`bekor`), and don't invent a fifth without a migration.
- If you extend the extraction schema (e.g., for a specialist-facing AI summary), keep the `true`/`false`/`not_mentioned` three-state convention — a two-state boolean anywhere near clinical data reintroduces exactly the bug this codebase was careful to avoid.
- RLS is currently "any authenticated user, full access" by design (documented, deliberate hackathon posture) — don't quietly tighten or loosen it without updating the comment in `001_schema.sql` that explains the choice; if you touch it, keep the reasoning visible for the next reader (and the auditor pass, and possibly a mentor who reads the code).
