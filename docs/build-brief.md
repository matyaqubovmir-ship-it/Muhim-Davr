# BUILD PROMPT FOR CLAUDE CODE — Muhim Davr (Perinatal Risk Registry, Xorazm AI Xakaton)

> Product name: **Muhim Davr**. The codebase's internal package name, some file/table naming, and older comments still say "ONA" (an earlier working name) — that's fine to leave as internal naming, it costs nothing. What matters is that every user-facing string (the app title, the Telegram bot's own messages if it ever names itself, the README, the pitch deck) says **Muhim Davr**, consistently, everywhere a judge or a patient sees it.

> Run Claude Code inside the `NEON` repo (package name `ona`) and paste this whole file as your first message, or save it as `CLAUDE.md` in the repo root. It is written to be read and executed by Claude Code directly, in that repo, against the code that already exists there. **Do not start a new project. Do not change the stack. Read section 1 before touching anything.**

---

## 0. WHO YOU ARE

You are acting as three roles at once, and you switch hats explicitly:

1. **Senior full-stack developer** continuing an existing, disciplined codebase — not starting a greenfield one. Your first job is to read and respect the conventions already established (section 2), not to impose your own.
2. **Code auditor** — before each checkpoint deadline below (section 8), you run the checklist in section 9 against your own work and fix what fails before moving on.
3. **Prompt/AI engineer** — the AI extraction layer already exists and is well-designed (section 2.5). Your job is to extend it consistently, never to loosen the "the model never decides, never invents, never diagnoses" boundary that is already enforced throughout this codebase. That boundary is a feature of the product and a strong, specific answer to the domain mentor's "regulatory/legal compliance" criterion — do not weaken it for convenience.

Work in short, verifiable increments, run the existing test suite after every change (`npm run test:run`), and tell the user what now works end-to-end, not what you intend to build.

---

## 1. WHAT ALREADY EXISTS — READ THIS BEFORE WRITING ANY CODE

This is not a hackathon idea on paper. The team has already built, and tested, the hard part: a real, evidence-based clinical risk engine with a working data pipeline. Do not rebuild it, do not switch it to a different stack, and do not "simplify" its safety guarantees to save time. What is missing is the **specialist-facing side** — the actual real-time monitoring dashboard the hackathon problem statement asks for — and visual polish. That is your job.

### 1.1 Stack (already chosen, already working — keep it)
- Vite + React 19 + TypeScript, Tailwind CSS v4 (CSS-first config via `@import "tailwindcss"` in `src/index.css` — there is no `tailwind.config.js`, theme tokens go in a `@theme` block in that same CSS file).
- Supabase (Postgres + RLS + Realtime + anonymous auth as a hackathon stand-in for staff accounts).
- Claude Haiku 4.5 via `@anthropic-ai/sdk`, called from a server-side endpoint (`api/extract.ts`, deployed as a Vercel serverless function, also served locally by a Vite middleware in `vite.config.ts`) — never called from the browser.
- A separate long-polling Telegram bot process (`bot/`, run with `npm run bot`, plain TypeScript, no framework) that is the **patient's entire interface** — she has no app.
- `npm run test:run` (Vitest), `npm run lint` (oxlint), `tsc -b` for typechecking. Use all three before declaring anything done.

### 1.2 What is already built and working (do not redo this)
- **`src/lib/risk.ts`** — `scoreAssessment()`: a pure, versioned, unit-tested weighted risk scorer producing `qizil` (red) / `sariq` (yellow) / `yashil` (green), with absolute flags (severe hypertension, suspected pre-eclampsia, severe anaemia, antepartum bleeding), banded and additive factors, and explicit handling of missing data as *unknown risk*, never silently-safe risk.
- **`src/lib/danger-signs.ts`** — a fixed WHO danger-sign list and a triage rule (`triageDangerSigns`) that is a lookup, not a score — no model has any path to changing which sign is an emergency.
- **`src/lib/schedule.ts`** — WHO 2016 eight-contact antenatal visit schedule, zone-adjusted, pure arithmetic on the LMP date, no model involved.
- **`src/lib/extract-client.ts` + `api/extract.ts`** — the AI layer: turns a midwife's free-text Uzbek note (or a patient's Telegram message) into structured field values via a constrained JSON-schema call to Claude, with an explicit three-state answer (`true` / `false` / `not_mentioned`) so "not measured" is never confused with "measured and normal." Hard 8-second client timeout, graceful fallback to a fully-typeable form on any failure. **This is your AI component for the hackathon's mandatory-AI-component rule — it is real, it runs on real input, and it already has a well-reasoned safety design. Extend it; do not add a second, weaker one.**
- **`src/components/EntryForm.tsx` → `ResultScreen.tsx`** — the midwife's mobile flow: paste/dictate a note → AI-assisted extraction with an "AI" badge on every field it filled → she verifies/corrects every value → submit → see the zone, factors, visit schedule, and static WHO protocol reminders.
- **`bot/`** — the patient's Telegram channel: `/start <code>` linking (`linking.ts`), free-text self-report triaged against the danger-sign list (`self-report.ts`), two-stage visit reminders (`reminders.ts`), and a dry-run-by-default district broadcast tool (`broadcast.ts`). The bot never diagnoses and never reassures — read the header comment in `bot/messages.ts`, it states the safety rule for every string a patient can read.
- **`supabase/migrations/001–003`** — a genuinely careful schema: `assessments` is append-only (enforced by a trigger, not just convention) with a strict null-vs-false-vs-true convention throughout; `escalations` is linked to the triggering `assessments` row via a **composite foreign key** on `(assessment_id, pregnancy_id)` so an escalation can never be mis-filed under the wrong pregnancy; `pregnancies.link_code` is a **generated column**, computed identically in `src/lib/link-code.ts` and pinned together by a test that reads the migration file.
- **Tests already in place**: `risk.test.ts`, `schedule.test.ts`, `schema-sync.test.ts` (fails the build if a scoring field has no column), `extraction-sync.test.ts` (fails the build if the server-side extraction field list drifts from the client's), `assessment-row` logic is covered indirectly. **Run these before and after every change.**

### 1.3 The core design rule that runs through the whole codebase — never violate it
> **The model never decides urgency, never chooses a date, never picks a medicine, and never invents a value it wasn't told.** Every file that touches the AI says this explicitly in its header comment. The risk zone comes only from `scoreAssessment`. The visit schedule comes only from `generateSchedule`. Danger-sign urgency comes only from the fixed list in `danger-signs.ts`. Protocol reminders are a static array, never generated. The model's only job anywhere in this system is to read what a person already said and report it back as structured data.

When you build the new specialist-facing UI in section 4, this rule extends to it: an AI-generated summary sentence on the escalation queue (if you add one) must be built the same way — extractive, sourced from `fired_factors` and the assessment row, never a free-generated clinical opinion. If you're unsure whether something you're about to build violates this rule, it does; find the version that doesn't.

---

## 2. THE PROBLEM YOU ARE SOLVING (Problem #9, official hackathon brief)

> *"Homilador ayollar va chaqaloqlar salomatligi tuman darajasida real vaqtda monitoring qilinmaydi: tahlillar yomonlashsa, OvaBMU mutaxassislari kech xabar topadi, yuqori xavfli holatlar oʻz vaqtida aniqlanmaydi."*

Plain English: at district level, pregnant women's and infants' health isn't monitored in real time. When a patient's results worsen, the district maternal-and-child-health specialists (**OvaBMU**) find out too late.

**This is the gap you must close, and right now it is the single biggest hole in the product.** The codebase already captures worsening results correctly (`risk_zone`, `escalations` with `status`, `fired_factors`, `source`). But **there is currently no screen anywhere that shows a specialist this data**, and **no notification reaches a specialist when an escalation is created** — only the patient gets a Telegram reply. A `qizil` assessment or an `ochiq` (open) escalation just... sits in Supabase, invisible, until someone runs a SQL query. That is exactly the failure mode the problem statement describes, still present in the product. Fixing this — not adding more midwife-side features — is the highest-value thing you can build before the next checkpoint.

---

## 3. GAP ANALYSIS — what's missing, mapped to what exists

| Gap | Why it matters | What already exists to build on |
|---|---|---|
| **No OvaBMU/specialist dashboard at all** | This *is* the problem statement. Nobody can see the registry. | `assessments`, `escalations`, `patients`, `pregnancies` tables; RLS already allows any authenticated read. |
| **No notification to specialists on a new/worsening escalation** | "OvaBMU mutaxassislariga avtomatik xabarnoma yuborish" is the literal requested feature. | Supabase Realtime is available on the plan already in use; `bot/telegram.ts` + the `patient_channels` linking pattern is a ready-made template for a parallel `staff_channels`. |
| **No patient/pregnancy creation or search UI** | `EntryForm` requires typing a raw pregnancy UUID by hand — unusable outside a demo where you already know the ID. | `patients` / `pregnancies` tables and their RLS policies already support insert from the client. |
| **`LINK_CODE_UI` strings exist in `src/lib/labels.ts` but no component renders them** | The midwife currently has no way to show/read out the Telegram linking code to a patient — the whole patient channel is unreachable from the UI. | `linkCodeForPregnancy()` in `src/lib/link-code.ts` already computes it; just needs a component. |
| **No role separation in the UI** (anonymous sign-in for everyone, documented as a deliberate hackathon stand-in in `src/lib/supabase.ts`) | Fine to leave the *auth* as-is given the remaining time, but the UI currently has no way to even *view* it as "I am a specialist" vs "I am a midwife." | A simple client-side role switch (not real auth) is enough for the demo; see section 4.5. |
| **Visual design is functional but minimal** — one mobile route, slate-gray Tailwind defaults, no dashboard surface at all | This is literally the "beautiful frontend design" the team asked for, and it's also where most of the demo's visual impact for the business/domain mentors will come from. | Tailwind v4 is already wired up; `ZONE_COLORS` in `labels.ts` is already the correct single source of truth for zone color — reuse it, don't fork it. |

**Sequencing:** build the specialist dashboard and its live notification path first (section 4.1–4.4). It is simultaneously the most important missing feature, the best demo material, and the natural home for "beautiful frontend design." Patient/pregnancy creation (4.5) and the link-code display (4.6) are close behind because without them the app cannot run a full demo starting from zero. Visual polish (section 5) is applied to all of it as you go, not bolted on at the end — but the registry/escalation screens are where it matters most.

---

## 4. WHAT TO BUILD

### 4.1 Routing
`App.tsx` currently has exactly one route (entry form → result screen). Introduce a minimal router (React Router, or a hand-rolled switch on `window.location` — pick whichever is faster for the team to reason about under time pressure; React Router is the safer default). Routes needed:
- `/` — role landing (see 4.5) or straight to the midwife flow, your call.
- `/entry` — the existing `EntryForm` → `ResultScreen` flow (keep as-is, just move it under a route).
- `/registry` — the new specialist registry (4.2).
- `/escalations` — the new specialist escalation queue (4.3).
- `/patients/:pregnancyId` — patient detail (4.4).
- `/patients/new` — quick patient/pregnancy creation (4.5).

### 4.2 Registry (`/registry`, `/registry/:district`) — hierarchical drill-down, this is a flagship "beautiful" screen

This is not one flat table. Build it as a **drill-down matching the problem statement's own framing** ("tuman darajasida real vaqtda monitoring" — district-level monitoring) and matching the product's own stated rollout (Xorazm tumani → Xorazm viloyati → milliy tarmoq, as pitched). Build the *mechanism* generically so it already scales to every future district and region without a rewrite, but **populate it only from real data** — do not hardcode a list of Uzbekistan's provinces or districts anywhere in the app. The district list comes from `select distinct district from patients`, so the screen is always honest about actual coverage and needs zero manual geography data-entry as the product expands.

**Data layer — one view, used everywhere "current zone" is needed.** Add a migration (`005_latest_assessment_view.sql`, following the existing numbering and comment style):
```sql
create view latest_assessment_per_pregnancy as
select distinct on (a.pregnancy_id)
  a.pregnancy_id, a.risk_zone, a.risk_score, a.visit_date, a.created_at,
  a.fired_factors, a.gestational_age_weeks
from assessments a
order by a.pregnancy_id, a.visit_date desc, a.created_at desc;
```
This view is the single source of "current zone" for the district overview counts, the per-district zone lists, and (if you refactor it in) the patient-detail screen's headline badge — do not duplicate "latest assessment per pregnancy" logic in more than one place.

**Level 1 — `/registry`: district overview.** One card per district that has at least one active pregnancy: district name, and three counts (qizil/sariq/yashil) from the view above, joined through `pregnancies` (`is_active = true`) and `patients.district`. Sort red-count descending, so the district needing the most attention leads. Click a card → `/registry/:district`.

**Level 2 — `/registry/:district`: zone-filtered patient list for that district.** Three columns (Qizil / Sariq / Yashil) — same visual language as the board view below — each listing active pregnancies in this district whose latest assessment is that zone: patient name, village, gestational week, EDD (`pregnancies.edd_date`, falling back to a computed estimate when null), last visit date, and a soft-amber staleness flag when there's been no assessment in a while. Click a patient row → `/patients/:pregnancyId` (section 4.4 — unchanged, this just routes into it with a "back to Sariq · Urganch" breadcrumb, which is trivial once you know which district/zone the click came from).

Level 3 is patient detail, already speced in 4.4 — don't rebuild it here, just link into it.

**Live updates:** subscribe to Postgres changes on `assessments` (and `escalations`) via Supabase Realtime, re-scoped to whichever level is mounted — the district overview re-fetches counts on any insert, a district's zone list re-fetches its own rows — so a new red result appears without a manual refresh, with a brief highlight animation on the row/card that changed. This single feature is worth emphasizing in the demo — it's the "real vaqtda monitoring" the brief asks for, made visible.

The escalation queue (4.3) stays global and non-geographic on purpose — a specialist should not have to click through geography to see who's in crisis right now.

### 4.3 Escalation queue (`/escalations`)
List `escalations` where `status in ('ochiq', 'qabul')`, newest first, with the `source` (`clinic` vs `telegram` — a specialist should instantly see "this came from the patient's own phone" vs "a midwife's visit"), the `reason` string (already human-readable, see `escalationReason()` in `bot/self-report.ts` and the equivalent path from `EntryForm`), and `fired_factors`.

Actions, each a real write respecting the existing `escalations_status_timestamps` CHECK constraint (so don't invent your own status machine — match the one already encoded in `supabase/migrations/001_schema.sql`):
- **Acknowledge** (`ochiq` → `qabul`): sets `acknowledged_at = now()`, `acknowledged_by = auth.uid()`.
- **Close** (`qabul` → `yopiq`): requires `resolution_note`, sets `closed_at`, `closed_by`.
- Show elapsed time since `created_at` prominently — this is your live "time to acknowledge" KPI, and it directly answers the problem statement's "kech xabar topadi" (finding out too late) complaint. Put the same aggregate (avg. time-to-acknowledge) on the registry or a small stats strip — it's a strong, honest number for the business mentor.

### 4.4 Patient detail (`/patients/:pregnancyId`)
Pull together what already exists, in one place: the assessment history (a real timeline chart of `bp_systolic`/`bp_diastolic`/`hemoglobin` over `visit_date`, zone-colored background bands — reuse `ZONE_COLORS`), the fired-factor list per assessment (reuse `FACTOR_SENTENCES` from `labels.ts`), the escalation history for this pregnancy, the `VisitSchedule` component (already built, just needs a real `lmpDate` from `pregnancies.lmp_date` instead of the estimated one), and — if a `patient_channels` row exists — the `patient_reports` feed (what she's messaged the bot, and how it was triaged), so a specialist can read her own words alongside the clinical numbers. This screen is where a domain mentor will judge "amaliy qo'llanish" (practical applicability) most closely — make sure every number here is traceable to a real row, never a placeholder.

### 4.5 Patient / pregnancy quick-create (`/patients/new`) + a lightweight role switch
A short form: full name, birth date, district, village (optional), phone (optional), then LMP date or gestational-age-now (compute LMP via `estimateLmpFromGestationalAge`, already exported from `schedule.ts`). On submit, insert into `patients` then `pregnancies`, and hand back the new `pregnancyId` so the midwife can go straight into `EntryForm` with it pre-filled — this also finally makes `EntryForm`'s pregnancy-ID box usable by non-demo users: replace the raw text box with a searchable combobox over `patients`/`pregnancies` (`full_name`, `district`) that resolves to a `pregnancyId`, with "create new patient" as an option inline.

For the demo, add a simple, clearly-labeled, **non-authoritative** role switch (e.g. a header dropdown: "Akusherka" / "OvaBMU mutaxassisi") that just changes which routes/nav items are shown — do not build real role-based auth in the time remaining; say so plainly in the README next to `src/lib/supabase.ts`'s existing note about anonymous sign-in being a stand-in, so nobody mistakes this for a security boundary.

### 4.6 Link-code display component
A small component (e.g. `src/components/LinkCode.tsx`) using the already-written `LINK_CODE_UI` strings from `labels.ts` and `linkCodeForPregnancy()` from `link-code.ts`: shows the six-character code large and legible (the midwife reads it aloud), with a short instruction line. Surface it on the patient detail screen and optionally at the end of the quick-create flow. This is the missing link that makes the whole Telegram patient channel — which is otherwise fully built — actually reachable from the UI.

### 4.7 Notification to specialists (do at least the first of these; the second is a strong stretch if time allows)
1. **In-app, via Supabase Realtime (do this — it's cheap and it's the core deliverable):** subscribe to `escalations` inserts/updates anywhere the specialist view is mounted; show a toast, increment a badge count in the nav, and play a short, non-jarring sound on a new `ochiq` escalation. This alone answers "avtomatik xabarnoma" for the web dashboard.
2. **Telegram, to the specialist's own phone (stretch, if CP1 is solid and time remains):** the existing `patient_channels` linking pattern (`bot/linking.ts`) is a near-exact template — a `staff_channels` table (`specialist_id` or just a free-text label for the hackathon, `telegram_chat_id`), a `/start_staff <code>` command or a fixed admin-configured chat id, and a new small function in `bot/` that sends a message on escalation creation. Keep it as close to the existing `broadcast.ts` / `telegram.ts` machinery as possible rather than inventing new bot infrastructure. If you build this, keep the dry-run-by-default caution that `broadcast.ts` already models — an alert channel that can spam a real doctor's phone during testing is worse than not having one.

---

## 5. "BEAUTIFUL FRONTEND" — DESIGN SPEC

The existing midwife flow is clean and usable but deliberately plain (correctly — it was built for speed and clarity under time pressure, not for a demo). The new specialist dashboard is where the visual bar needs to go up, because it is what judges will spend the most time looking at and clicking through. Bring the midwife flow up to the same system without changing its layout logic (it works; don't rebuild it, restyle it).

### 5.1 Visual tone
Calm, clinical, trustworthy — closer to a modern hospital ops dashboard than a consumer app or, worse, a traffic-light toy. The existing zone colors (`#BE3A2B` red, `#B97609` amber, `#2C7A50` green, from `labels.ts`) are already well-chosen — muted, serious, not neon — **keep them as the single source of truth** and build the rest of the palette around them.

### 5.2 Design tokens — add these to `src/index.css` as a Tailwind v4 `@theme` block
Since this project uses Tailwind v4's CSS-first config (no `tailwind.config.js`), add tokens like this, matching the existing zone hex values exactly so nothing drifts from `labels.ts`:

```css
@import "tailwindcss";

@theme {
  --color-bg: #F7F9FB;
  --color-surface: #FFFFFF;
  --color-border: #E3E8EF;
  --color-text-primary: #0F172A;
  --color-text-muted: #64748B;
  --color-brand: #2563EB;
  --color-brand-soft: #EFF6FF;

  --color-zone-qizil: #BE3A2B;
  --color-zone-qizil-soft: #FBEAE8;
  --color-zone-sariq: #B97609;
  --color-zone-sariq-soft: #FCF1DF;
  --color-zone-yashil: #2C7A50;
  --color-zone-yashil-soft: #E7F3ED;
}
```
This gives you `bg-zone-qizil`, `text-zone-sariq`, etc. as real Tailwind utilities, while `ZONE_COLORS` in `labels.ts` stays the runtime source of truth for anywhere you need the raw hex (inline styles, charts) — keep the two numerically identical; don't let a designer's eye "improve" one without updating the other.

Never rely on color alone for the zone — always pair the badge with the word (`ZONE_NAMES` already gives you QIZIL/SARIQ/YASHIL) and a distinct icon shape, both for accessibility and because color-blind clinicians exist. Check contrast (WCAG AA) for every zone-color-on-background pairing you introduce, don't eyeball it.

### 5.3 Typography
`Inter` or `Manrope`, self-hosted (don't depend on a CDN at the venue — bundle the font). One weight jump for emphasis (500→600), not a big type scale — this is a data-dense clinical UI, not a marketing page.

### 5.4 Layout
- **App shell** for the specialist views: slim top bar (product name "Muhim Davr", role switch, notification bell with live badge from 4.7) + left nav (Registry, Escalations, Patients) + main content area. The existing midwife `/entry` flow can stay a focused, chrome-free mobile page — don't force it into the same desktop shell.
- **Registry:** sortable table as default (zone pill as the leftmost column, not a full-row color wash — that gets noisy at scale), board view as a toggle (see 4.2).
- **Escalation queue:** a list of cards, not a dense table — each escalation deserves visual weight given what it represents; source badge (clinic/telegram), elapsed-time chip that goes visually more urgent past some threshold, action buttons.
- **Patient detail:** reuse the existing `pb-24` fixed-bottom-button mobile pattern only on the mobile midwife context; on the desktop specialist context use a normal scrolling layout with the timeline chart up top.
- Design empty, loading, and error states explicitly (skeleton rows for the registry while it loads, a calm "hech qanday ochiq signal yo'q" empty state for the escalation queue, a clear retry affordance if a Realtime subscription drops) — no bare browser spinners or blank screens.

### 5.5 Motion
Subtle and purposeful only: new escalation row fades/slides in with a brief highlight; zone badge cross-fades on change; notification badge does one small pulse on increment. Nothing decorative beyond this — it's a clinical tool, not a landing page.

### 5.6 Copy discipline — follow the existing split, don't blur it
This codebase already enforces a hard separation: **`src/lib/labels.ts` is clinician-facing copy** (can show a score, a factor list, a zone) and **`bot/messages.ts` is patient-facing copy** (never diagnoses, never reassures, never names a condition). Every new string you write goes in exactly one of these files, following its existing rules — do not write a new patient-visible string outside `bot/messages.ts`, and do not casually reuse a clinician-facing string on anything a patient might see. All UI copy stays in Uzbek (Latin script), matching what's there.

---

## 6. NON-FUNCTIONAL / SAFETY CHECKS SPECIFIC TO THIS CODEBASE

- Never add an `UPDATE` or `DELETE` path against `assessments` from the new UI — the database trigger will reject it, and if you find yourself wanting to, the append-only design is telling you to write a new assessment row instead.
- Any new scoring-relevant field must be added to `risk.ts`'s `SCORING_INPUT_FIELDS`, the migration, *and* checked against `schema-sync.test.ts` — don't add a column the scorer can't see or a scoring input with nowhere to live.
- Any new escalation-status transition must satisfy `escalations_status_timestamps` — write the acknowledge/close actions as the only two mutations, matching the four states already defined (`ochiq`/`qabul`/`yopiq`/`bekor`), and don't invent a fifth without a migration.
- If you extend the extraction schema (e.g., for a specialist-facing AI summary), keep the `true`/`false`/`not_mentioned` three-state convention — a two-state boolean anywhere near clinical data reintroduces exactly the bug this codebase was careful to avoid.
- RLS is currently "any authenticated user, full access" by design (documented, deliberate hackathon posture) — don't quietly tighten or loosen it without updating the comment in `001_schema.sql` that explains the choice; if you touch it, keep the reasoning visible for the next reader (and the auditor pass, and possibly a mentor who reads the code).

---

## 7. AI COMPONENT — WHAT TO SAY ABOUT IT, ACCURATELY

Be precise in the pitch about what's already true, because it's a genuinely strong answer and overclaiming would weaken it:
- **Layer 1 (decision): a transparent, weighted, versioned rule engine (`risk.ts`)**, not a black box — auditable, defensible to a medical mentor, reproducible from a frozen row years later.
- **Layer 2 (AI): Claude Haiku 4.5, structured-output-constrained, extractive only.** It never scores, never triages, never invents a value, and every field it can't find evidence for comes back explicitly as "not mentioned" rather than a guessed default — the system prompts in `api/extract.ts` are unusually rigorous about this and are worth quoting from directly in the pitch (the worked examples in the system prompts are a good thing to show a technical mentor who asks "how do you stop it hallucinating").
- If you add a specialist-facing AI summary as a stretch item, keep it in the same mold: a sentence built from `fired_factors` and the structured row, not a free-generated clinical opinion, with the same three-state discipline.

---

## 8. EXECUTION PLAN (sequenced against the real clock)

**Today, 18 September — before Checkpoint 1 (14:00 Tashkent time):**
1. `npm run test:run`, `npm run lint`, `tsc -b` on the current codebase — confirm the baseline is green before you add anything.
2. Routing skeleton (4.1) + Registry screen (4.2) reading real data (no Realtime yet, a plain fetch is fine for CP1) — this is the single most important thing to have true and demoable before Checkpoint 1: a specialist can now *see* the registry that did not exist this morning.
3. Escalation queue (4.3) with acknowledge/close wired to real writes.
4. Auditor pass (section 9) before 14:00.

**Today, after Checkpoint 1 (14:00–21:00 block):**
5. Realtime subscriptions on registry + escalation queue (4.2/4.3's live-update requirement, 4.7.1).
6. Patient detail screen (4.4), link-code component (4.6).
7. Patient/pregnancy quick-create + combobox in `EntryForm` (4.5).
8. Apply the full design system from section 5 across the new screens and restyle the existing midwife flow to match tokens.

**Tomorrow, 19 September — before Checkpoint 2 (14:00):**
9. Stretch: Telegram-to-specialist alert (4.7.2), if the above is solid.
10. Seed script: realistic demo patients spread across all three zones, at least one live "worsening" scenario to trigger during the demo.
11. Update the README: setup, architecture in words, the AI Design section (7), an honest list of what's stubbed (auth) vs real.
12. Clean commits, push, prepare the CP2 presentation.
13. Full auditor pass (section 9).

---

## 9. AUDITOR CHECKLIST — run before every checkpoint

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

---

## 10. PITCH SCRIPT SKELETON (7 minutes: 3 pitch + 2 demo + 2 Q&A)

- **0:00–0:45 — the human scenario:** a district OvaBMU specialist finding out three days too late that a patient's blood pressure crossed into danger — and, honestly, that this was true of *our own product* as of this morning, which is exactly why the specialist dashboard is what we built between checkpoints.
- **0:45–1:30 — why this is tractable, not just another AI demo:** it's a triage/notification problem, not a diagnosis problem; the AI extracts, a transparent rule engine decides, a live registry surfaces it. Say this precisely — it pre-empts "is this safe" from the domain mentor.
- **1:30–3:00 — the product and who it's for:** the midwife's note-to-form flow, the patient's own Telegram channel (no app needed), and the new district registry — three real interfaces, one shared clinical spine.
- **3:00–5:00 — live demo:** submit a worsening assessment for a seeded patient on stage → watch it appear red on the registry in real time → open the escalation → acknowledge it → show the patient detail timeline and, if linked, her own Telegram messages.
- **5:00–7:00 — Q&A:** be ready for "how do you know the AI isn't inventing a value" (answer with the three-state extraction design and the worked examples in the system prompt), "what happens with no internet in a village" (the bot is a separate always-retrying process; the form still works fully typed with no AI at all), "who is liable for a wrong recommendation" (the system makes no recommendation — it reports a WHO-sourced factor list and a specialist decides, same as the fixed, never-generated protocol reminders on the midwife's own screen).

---

## 11. OPEN QUESTIONS — confirm fast so Claude Code isn't guessing

1. Is this repo already deployed to Vercel with a live URL, or does CP1 demo from `npm run dev` on the laptop? (Affects whether the Telegram bot, which needs to be running as a separate process, is part of the live demo or just described.)
2. Router choice: pull in React Router, or hand-roll something minimal? (Recommendation above: React Router, for speed and familiarity.)
3. Pursue the Telegram-to-specialist alert (4.7.2) at all, or keep the notification story to the in-app Realtime path only for this stage?
4. Any real (anonymized) reference data, or is everything for the demo clearly-labeled synthetic seed data?
5. Who is presenting, so the pitch script's tone matches their voice?

---

**Start now with step 1 of section 8.** Report back once the registry screen is showing real, live Supabase data with correct zone badges — that is the single most important thing to have true and demoable before Checkpoint 1 this afternoon, because it is the one screen that did not exist this morning and is the actual answer to the hackathon's problem statement.
