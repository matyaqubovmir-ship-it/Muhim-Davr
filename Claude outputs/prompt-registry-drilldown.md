Build the `/registry` screen: a district drill-down, not a flat table. Read section 4.2 in CLAUDE.md first (it's been rewritten with this exact spec) — the summary below is a pointer, not a substitute.

**Why drill-down, not a flat list:** the hackathon problem statement is literally "tuman darajasida real vaqtda monitoring" (district-level monitoring), and our own pitch's rollout is district → region → national, pilot-first. So the screen goes: pick a district → see its red/yellow/green split → click a color to see who's in it → click a patient for full detail (4.4, already built or already speced — don't touch it, just link into it).

**Do not hardcode Uzbekistan's geography anywhere.** The district list is `select distinct district from patients` — real coverage only. This makes the screen honest today (Xorazm only) and correct automatically the day a second viloyat's patients get added, with zero code changes.

Steps:
1. Migration `005_latest_assessment_view.sql`: a `latest_assessment_per_pregnancy` view (`distinct on (pregnancy_id) ... order by visit_date desc, created_at desc`) — this becomes the one place "current zone" is computed from. Don't duplicate that logic elsewhere in JS.
2. `/registry` — one card per district with ≥1 active pregnancy, showing qizil/sariq/yashil counts from the view, sorted red-count-desc.
3. `/registry/:district` — three columns (Qizil/Sariq/Yashil), each listing active pregnancies in that district at that zone: name, village, gestational week, EDD (`pregnancies.edd_date`), last visit date, staleness flag if overdue. Row click → `/patients/:pregnancyId`.
4. Realtime: district overview re-fetches counts on any `assessments` insert; a mounted district list re-fetches its own rows. Same Supabase Realtime pattern already used elsewhere in this codebase (see `EscalationQueue.tsx` for the query-shape convention, even though it isn't Realtime-subscribed yet either — match its explicit-foreign-key style embeds).
5. Reuse `ZONE_COLORS`, `ZONE_NAMES` from `labels.ts` — don't invent new zone styling.
6. Empty/loading states: skeleton cards while districts load, a calm empty state if a district has zero patients in a zone (not just a blank column).

Run `npm run test:run`, `npm run lint`, `tsc -b` before you call this done. Report back with a real district showing real counts, and confirm a new qizil assessment moves a patient between columns without a manual refresh.
