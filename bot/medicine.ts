/**
 * Detecting a question about medicine, so the bot can decline to answer it.
 *
 * Keyword matching, deliberately. This is a refusal gate, and a refusal gate
 * driven by a language model is a refusal gate that can be talked out of. The
 * list is Uzbek as a patient writes it — in Latin and in Cyrillic, because both
 * are in everyday use — plus the Russian a patient may fall back on, plus the
 * drug names that appear in the WHO reminders a midwife might have mentioned.
 *
 * FALSE POSITIVES ARE THE SAFE DIRECTION. Declining to discuss medicine when she
 * was not asking costs her one extra line telling her to ask her midwife.
 * Answering when she was asking is the thing this system will not do — and it
 * cannot anyway, since no reply the bot sends is generated. This gate decides
 * only whether the refusal line is added.
 *
 * The gate never suppresses a danger sign: handleSelfReport triages first and
 * adds this refusal afterwards, so a woman who writes "qonim ketyapti, qaysi
 * dorini ichay?" gets the emergency reply, with the medicine line after it.
 */

/** One apostrophe for o‘ and g‘, whichever of the five a phone produced. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[‘’ʻʼ'`]/g, '‘')
}

const MEDICINE_TERMS: readonly string[] = [
  // Uzbek, Latin script
  'dori',
  'dorilar',
  'tabletka',
  'kapsula',
  'ukol',
  'in‘eksiya',
  'retsept',
  'preparat',
  'doza',
  'ichsam',
  'ichsa',
  'ichay',
  'ichaymi',
  'icheymi',
  'ichayapmi',
  'og‘riq qoldiruvchi',
  // Uzbek, Cyrillic script
  'дори',
  'таблетка',
  'капсула',
  'укол',
  'инъекция',
  'рецепт',
  'препарат',
  'доза',
  'ичсам',
  'ичай',
  // Russian
  'лекарство',
  'лекарств',
  'таблетки',
  // Drug names, both scripts
  'aspirin',
  'аспирин',
  'kaltsiy',
  'kalsiy',
  'кальций',
  'temir',
  'темир',
  'folat',
  'фолат',
  'vitamin',
  'витамин',
  'magneziya',
  'магнезия',
  'antibiotik',
  'антибиотик',
  'paratsetamol',
  'парацетамол',
].map(normalise)

function escapeRegExp(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Each term, on a word boundary at the start, followed by up to eight letters of
 * agglutinative suffix: dori -> dorini, dorilarni, doriga; aspirin -> aspirinni.
 * \p{L} rather than \w so Cyrillic letters count as letters.
 */
const MEDICINE_PATTERNS: readonly RegExp[] = MEDICINE_TERMS.map(
  (term) => new RegExp(`(^|[^\\p{L}])${escapeRegExp(term)}\\p{L}{0,8}([^\\p{L}]|$)`, 'u'),
)

/** True when the message looks like it is asking about medicine. */
export function asksAboutMedicine(text: string): boolean {
  const normalised = normalise(text)
  return MEDICINE_PATTERNS.some((pattern) => pattern.test(normalised))
}
