Build `/patients/:pregnancyId` for real — Registry already links here but it's a placeholder. Read section 4.4 in CLAUDE.md first.

One page, in order:
1. Header: name, district/village, age, gravida/para, EDD (`edd_date`, or computed), current zone badge (from `latest_assessment_per_pregnancy`).
2. Assessment history: a timeline chart of bp_systolic/bp_diastolic/hemoglobin over visit_date, zone-colored background bands (`ZONE_COLORS`). Each point's fired_factors on hover/click, in plain sentences (`FACTOR_SENTENCES`).
3. Escalation history for this pregnancy — status, source, reason, timestamps.
4. `VisitSchedule` component, wired to this pregnancy's real `lmp_date` (it currently only takes an estimated one — fix that call site).
5. `LinkCode` component.
6. If a `patient_channels` row exists: her `patient_reports` feed (what she's messaged the bot, how it triaged), so her own words sit next to the clinical numbers.

Every number on this page must trace to a real row — no placeholders. Add a "← Sariq · <tuman>" back link when arrived from the registry (query param or router state, your call).

Run `npm run test:run`, `npm run lint`, `tsc -b`. Report back with a real pregnancy ID showing real history.
