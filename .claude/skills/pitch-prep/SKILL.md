---
name: pitch-prep
description: "Prepare or rehearse the Muhim Davr hackathon pitch and demo: the 7-minute script, how to describe the AI component accurately (rule engine decides, model only extracts), and likely Q&A answers."
---

# Pitch prep

## AI component — what to say about it, accurately

Be precise in the pitch about what's already true, because it's a genuinely strong answer and overclaiming would weaken it:
- **Layer 1 (decision): a transparent, weighted, versioned rule engine (`risk.ts`)**, not a black box — auditable, defensible to a medical mentor, reproducible from a frozen row years later.
- **Layer 2 (AI): Claude Haiku 4.5, structured-output-constrained, extractive only.** It never scores, never triages, never invents a value, and every field it can't find evidence for comes back explicitly as "not mentioned" rather than a guessed default — the system prompts in `api/extract.ts` are unusually rigorous about this and are worth quoting from directly in the pitch (the worked examples in the system prompts are a good thing to show a technical mentor who asks "how do you stop it hallucinating").
- If you add a specialist-facing AI summary as a stretch item, keep it in the same mold: a sentence built from `fired_factors` and the structured row, not a free-generated clinical opinion, with the same three-state discipline.

## Pitch script skeleton (7 minutes: 3 pitch + 2 demo + 2 Q&A)

- **0:00–0:45 — the human scenario:** a district OvaBMU specialist finding out three days too late that a patient's blood pressure crossed into danger — and, honestly, that this was true of *our own product* as of this morning, which is exactly why the specialist dashboard is what we built between checkpoints.
- **0:45–1:30 — why this is tractable, not just another AI demo:** it's a triage/notification problem, not a diagnosis problem; the AI extracts, a transparent rule engine decides, a live registry surfaces it. Say this precisely — it pre-empts "is this safe" from the domain mentor.
- **1:30–3:00 — the product and who it's for:** the midwife's note-to-form flow, the patient's own Telegram channel (no app needed), and the new district registry — three real interfaces, one shared clinical spine.
- **3:00–5:00 — live demo:** submit a worsening assessment for a seeded patient on stage → watch it appear red on the registry in real time → open the escalation → acknowledge it → show the patient detail timeline and, if linked, her own Telegram messages.
- **5:00–7:00 — Q&A:** be ready for "how do you know the AI isn't inventing a value" (answer with the three-state extraction design and the worked examples in the system prompt), "what happens with no internet in a village" (the bot is a separate always-retrying process; the form still works fully typed with no AI at all), "who is liable for a wrong recommendation" (the system makes no recommendation — it reports a WHO-sourced factor list and a specialist decides, same as the fixed, never-generated protocol reminders on the midwife's own screen).
