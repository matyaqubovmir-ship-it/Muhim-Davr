# Muhim Davr

**Homilador ayollar xavfini tuman darajasida real vaqtda kuzatish.**
A perinatal risk registry for Xorazm: when a pregnant woman's results worsen,
the district maternal-and-child-health specialist (OvaBMU) sees it on screen,
live, instead of finding out days later. (`ona` is the internal package name.)

Built for the Xorazm AI Xakaton, problem #9: *"Homilador ayollar va chaqaloqlar
salomatligi tuman darajasida real vaqtda monitoring qilinmaydi: tahlillar
yomonlashsa, OvaBMU mutaxassislari kech xabar topadi."*

## Three interfaces, one clinical spine

| Who | Where | What they do |
|---|---|---|
| **Midwife (akusherka)** | `/entry`, `/patients/new`, `/visits` — phone-first | Registers a woman, types a visit note **or photographs a lab sheet / uploads a PDF**, lets the AI fill the form, checks every value, saves. Sees the zone, the factors behind it, the WHO visit schedule and static protocol reminders. Sees who is due today and who is late. |
| **OvaBMU specialist** | `/dashboard`, `/registry`, `/escalations`, `/visits`, `/patients/:id` | Dashboard of every district; drill-down district → zone → woman; a live alert queue with acknowledge and close; the appointments calendar; each woman's history, chart, stored schedule with the reminders sent, lab documents and her own Telegram messages. A toast, badge and sound when an alert opens, and optionally a Telegram alert and a morning digest on their own phone. |
| **The pregnant woman** | Telegram only — no app, no password | Links with a six-character code the midwife reads out. Reports how she feels; danger signs reach the specialist's queue. Gets visit reminders two days before and on the morning of each contact. |

## AI design — what the model does and what it never does

The system has two layers, and the line between them is the safety design.

**Layer 1 — the decision: a transparent rule engine, not a model.**
`src/lib/risk.ts` is a weighted, versioned point table. Four findings force red on
their own (blood pressure 160 systolic or 110 diastolic and above, suspected
pre-eclampsia, haemoglobin < 70 g/L, bleeding); the rest add points (red ≥ 7,
yellow ≥ 3). Every score is stored with
its inputs and the rules version that produced it, so any past result can be
reproduced from its own row years later. Missing data is shown as *unknown risk*,
never as a reassuring green. The visit schedule (`schedule.ts`, WHO 2016
eight-contact model) is arithmetic on a date; danger-sign urgency
(`danger-signs.ts`) is a fixed WHO list. None of these involve a model.

**Layer 2 — the AI: Claude Haiku 4.5, extraction only.**
The model reads what a person already said — a midwife's Uzbek note, or a
patient's Telegram message — and reports it back as structured fields
(`api/extract.ts`). It never scores, never triages, never picks a date or a
medicine, and never writes anything a patient reads. Every yes/no field has three
answers, `true` / `false` / `not_mentioned`, so "nobody measured it" can never be
stored as "measured and normal". From the system prompt:

> "Not mentioned" is "not_mentioned". It is NEVER "false". A finding nobody wrote
> about is not a finding that was ruled out. [...] a skipped test recorded as a
> negative test can hide a woman who needs urgent care.

The same rules apply to a **photo or PDF of a lab sheet**: the model reads the
values written on it, never a printed reference range, and leaves unreadable
handwriting or repeated results empty for the midwife to type. Photos are
redrawn in the browser (smaller, and without the GPS position a phone photo
carries); the file is kept with the visit in a private Storage bucket.

**Measured, not assumed.** `npm run eval:ai` runs 23 fixed cases — midwife
notes in Uzbek and Russian, patient messages — through the real endpoint and
scores every field. On Claude Haiku 4.5: 23/23 cases and 441/441 fields right
in two runs, with **zero invented values and zero "not mentioned" reported as
absent**; median 2.2 s per note. Cases include a test not done, explicit
negatives, g/dL haemoglobin, half a blood pressure, a plan that is not a
history, and a note that states nothing at all.

The midwife sees an **AI** badge on every field the model filled and confirms or
corrects each one before saving; the audit trail keeps the model's raw answer and
whether she changed it. If the AI is slow (8-second limit), down, or the key is
missing, the form simply stays a normal typed form.

**Who is liable for a wrong recommendation?** The system makes no recommendation.
It reports a WHO-sourced factor list and a zone from published rules; a specialist
decides. The Telegram bot never diagnoses, never reassures, and never names a
medicine — every sentence it can send is a fixed string in `bot/messages.ts`.

## How a worsening result reaches a specialist

1. The midwife saves a visit. `scoreAssessment` returns **qizil**.
2. The app writes the assessment (append-only — the database rejects any edit or
   delete) and an escalation linked to it by a composite key, so it can never be
   filed under the wrong woman.
3. Supabase Realtime pushes both inserts to every open specialist screen: the
   district card and the woman's row turn red, the queue gains a card, the bell
   counts up, a short sound plays. No refresh.
4. The specialist acknowledges (`ochiq → qabul`), then closes with a note
   (`qabul → yopiq`). Time-to-acknowledge is shown on the queue and dashboard.
5. Optionally, the bot sends the specialist's Telegram a short alert: district,
   source, reason and a link — never the patient's name.

The same path runs when the woman herself reports a danger sign on Telegram;
the queue marks those as coming from her own phone.

## Appointments — who hears about a visit, and when

The schedule is arithmetic on the LMP (WHO 2016, eight contacts), adjusted by
zone and stored as rows the whole system reads from:

- **Sariq** adds a contact between each pair from week 26. **Qizil** uses the
  same weeks, pulls the next contact to today, and adds a **check-up within a
  week** — a red woman is never left weeks without a date.
- **The patient** (if linked on Telegram) gets a reminder two days before and on
  the morning of each contact — or the day before, if the two-day one could not
  go out. A reminder whose send failed is retried, not lost.
- **The midwife and specialist** see every planned contact on `/visits`:
  overdue, today, tomorrow, the next two weeks — red first, and those with no
  Telegram marked *remind by phone*. With `STAFF_ALERT_CHAT_ID` set, the
  specialist also gets a **07:00 digest** on Telegram (counts only, no names).
- The registry flags a woman as overdue once a planned date passes unseen, and
  flags anyone at 39+ weeks with nothing planned.

### A contact nobody recorded — the next morning (needs migration 008)

From **09:00 the day after** a planned contact with no visit entered:

- **The specialist** (with `STAFF_ALERT_CHAT_ID`) gets one Telegram message per
  contact: district, date, and whether she is on Telegram or must be phoned.
  Dry run unless `STAFF_ALERTS=send`, like every staff alert; no names.
- **The patient** (if linked) is told the visit *was not recorded* — never that
  she skipped it: the system only knows nothing was entered — and asked to call
  her midwife. The same message opens a **so‘rovnoma** answered with buttons:
  blood pressure (or *O‘lchay olmayman*), then each WHO danger sign as Ha / Yo‘q
  (*is the pain severe?* and *can you get up?* only after a "Ha"), then anything
  else in her own words.
- **Every answer goes through the same rules as a typed report** — the WHO list
  and the point table, no model. A "Ha" to an emergency sign, or a reading of
  160/110+, ends the survey at once with the go-now reply and raises the red
  alert. A message that is not an answer is triaged as an ordinary report, then
  the question is asked again. Unanswered stays *javob berilmadi*, never "no".
- **Her answers** land on her patient page as one report (with an assessment
  when she gave a reading), and the specialist gets a Telegram summary unless a
  red alert already covered them. A survey unfinished after 24 hours is closed
  with whatever she answered.

The visit itself is **not** marked missed (see 004): it stays planned until a
midwife records it or the schedule is rewritten.

## Run it

```bash
npm install
cp .env.example .env.local        # fill in the Supabase URL and anon key, Anthropic key, bot token
```

**Database.** Run each file in `supabase/migrations/` in order (001 → 008) in the
Supabase SQL editor. Enable anonymous sign-ins (Authentication → Providers).
007 adds document storage, reminder retries, Tashkent-dated visits and live
updates for new registrations; the app runs without it, and says so where a
feature needs it. 008 adds the next-morning follow-up and survey above; without
it the bot runs as before and logs that 008 is missing.

```bash
npm run dev          # the web app, with /api/extract served locally
npm run bot          # the Telegram bot — a separate, long-running process
npm run test:run     # unit tests (vitest)
npm run lint         # oxlint
npx tsc -b           # typecheck
npm run eval:ai      # the AI extraction against 23 fixed cases (live model, a few cents)
```

`/api/extract` deploys as a Vercel serverless function (`vercel.json`); set the
same environment variables in the Vercel project.

## Demo

```bash
npm run seed                 # dry run: prints the plan, writes nothing
npm run seed -- --apply      # writes 14 synthetic women across 5 districts
npm run demo:worsen          # the live moment, if not typed on stage
npm run seed -- --retire     # takes the demo women off the registry afterwards
```

The seed covers every zone, one woman not yet assessed, one overdue, an
acknowledged and a closed escalation, an open clinic alert and an open alert
from a patient's own Telegram. Every value goes through the real scorer and
the real write paths — no zone is typed in by hand. Every row is marked
synthetic in the database, and no phone number or Telegram chat is attached.

**On stage:** open `/dashboard` as *OvaBMU mutaxassisi* on one screen and
`/entry` as *Akusherka* on another. Pick **Oydin Karimova** (Urganch, currently
sariq), enter BP 164/112 with protein in the urine, save. Her row turns red on the
registry, the alert appears in the queue with a sound, and it can be
acknowledged and opened to her timeline.

**Telegram alert to a specialist** (optional): set `STAFF_ALERT_CHAT_ID` (one
person's id from @userinfobot, or a group's) and run `npm run bot`. It only
logs what it would send until `STAFF_ALERTS=send` is set. `APP_URL` adds a link.

## What is real and what is stubbed

**Real, running on real data:** the rule engine and its tests; AI extraction on
real Uzbek and Russian input — typed notes and lab-sheet photos/PDFs — with the
fallback to typing; the appointments calendar and reminder tracking; the append-only record and its
database constraints; the district registry, dashboard and queue reading
Supabase and updating over Realtime; acknowledge/close writes; the patient page;
patient registration and the name search; the Telegram bot (linking,
self-report triage, visit reminders, district announcements, specialist alerts).

**Stand-ins for the hackathon:**

### Access and roles are hackathon stand-ins, not security

- **Sign-in is anonymous.** Every device gets an anonymous Supabase session
  (`src/lib/supabase.ts`), and the RLS policies treat every session as clinical
  staff (`supabase/migrations/001_schema.sql`). Anyone who can open the app can
  read and write patient records.
- **The role switch ("Akusherka" / "OvaBMU mutaxassisi") only chooses which
  tabs are shown.** It is stored in the browser, every URL works whichever role
  is picked, and the database cannot tell the roles apart
  (`src/lib/role.ts`). It is not a login and not a permission.
- Before real patient data is entered: real staff accounts, and RLS policies
  scoped by role and district.

**Also not yet built:** infant (post-birth) follow-up; import from existing
clinic records; the link code is derived from the pregnancy id and cannot be
rotated (fine for a pilot, replaced by an invitation table at scale).

**Demo data is synthetic.** No real patient's data is in this repository or in
the demo database.

## Secrets

`ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN` and `SUPABASE_SERVICE_ROLE_KEY` live
only in `.env.local` (git-ignored) and never carry a `VITE_` prefix — Vite
would put a `VITE_` variable in the browser bundle. `bot/config.ts` refuses to
start if it finds a `VITE_` copy of the token, and `bot/boundary.test.ts` fails
the build if anything under `src/` imports the bot. `/api/extract` only answers
requests carrying a live app session, so the Anthropic key cannot be spent by
anyone who finds the URL.

## Layout

```
src/lib/       rules, schedule, danger signs, row builders — pure and tested
src/components/ the midwife form and the specialist screens
api/extract.ts  the only place a model is called
bot/            the Telegram channel (long polling; no webhook, no public URL needed)
scripts/        demo seed
supabase/migrations/  schema, constraints, views and RLS, with the reasoning in comments
```
