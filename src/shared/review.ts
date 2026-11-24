// Writing review with Claude (feature 19) and the workshop (feature 22): settings, prompts, and the
// shape of a review. Pure logic, shared by the main process (which calls Claude) and the window.

/** Models offered for reviews. Haiku is deliberately not offered. */
export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'מומלץ: איכות גבוהה במחיר סביר', input: 4, output: 20 },
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2', note: 'המודל החזק ביותר, יקר פי שניים', input: 8, output: 40 },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'מהיר וזול יותר', input: 2, output: 10 }
] as const
export type ModelId = (typeof MODELS)[number]['id']
export const DEFAULT_MODEL: ModelId = 'claude-opus-5-5'

export type Effort = 'low' | 'medium' | 'high' | 'xhigh'
export const EFFORTS: { id: Effort; label: string }[] = [
  { id: 'low', label: 'מהיר' },
  { id: 'medium', label: 'רגיל' },
  { id: 'high', label: 'יסודי' },
  { id: 'xhigh', label: 'יסודי מאוד' }
]

/** One kind of review ("skill"): a name and what Claude should look at */
export interface ReviewKind {
  id: string
  name: string
  prompt: string
  /** Picked by default in the review panel */
  on?: boolean
}

export interface AiSettings {
  model: ModelId
  effort: Effort
  /** General instructions, like a claude.ai project's instructions ("ביקורת כתיבה") */
  instructions: string
  kinds: ReviewKind[]
}

export const DEFAULT_INSTRUCTIONS = `אתה עורך ספרותי ותיק שקורא כתבי יד בעברית. הכותב חוזר לכתיבה כתחביב ומבקש ביקורת כנה, בונה ועניינית: לא מחמאות ריקות ולא ריכוך. אם משהו לא עובד, אמור זאת בבירור והסבר למה. אם משהו עובד, אמור גם את זה, ואמור למה הוא עובד, כדי שהכותב יידע מה לשמור.

איך לכתוב את הביקורת:
- "בשורה התחתונה" קודם: שלושה עד חמישה משפטים. האם הטקסט עובד, מה הדבר הכי חזק בו, ומה הדבר העיקרי שצריך תיקון. אפשר להשוות לטקסטים קודמים אם הם ידועים.
- "מה עובד": דברים מסוימים, עם ציטוט, ולמה הם עובדים (מוטיב חוזר, פרט שאומר הכול בלי להסביר, הקבלה, קיצור במקום הנכון, הומור שנובע מהדמות).
- "מה צריך עבודה": מסודר לפי חשיבות. קודם מבנה, נקודת מבט ודמויות, אחר כך ניסוח, ובסוף הגהה. כל הערה נשענת על ציטוט מדויק, אומרת מה הבעיה ולמה היא מפריעה לקורא, ומציעה כיוון. בבעיות קטנות (זמן דקדוק, מילה שגויה, הקלדה) אפשר להציע את התיקון עצמו. לא לשכתב פסקאות שלמות במקום הכותב.
- הגהה: לרכז טעויות הקלדה, דקדוק ומירכאות חסרות, כל אחת עם התיקון.
- בסוף: "מה זה מלמד על הכתיבה שלך" (דפוסים, חוזקות והרגלים שחוזרים) ו"מה הייתי עושה עכשיו" (הצעד הבא, במשפט או שניים).
- עברית פשוטה וישירה, פנייה ישירה לכותב ("אתה"), בלי ז'רגון.

מה כבר ידוע על הכתיבה שלו (מביקורות קודמות; לשים לב אם זה חוזר, ולציין גם כשזה השתפר):
- חזק במוטיבים חוזרים, בהקבלות ובסגירת מעגלים, ובהומור יומיומי ישראלי שנובע מהדמות.
- תגובות גוף גנריות ומוגזמות (הסמקה, החוורה, דמעות, כמה תגובות ברצף): ההרגל הכי עקבי שלו.
- קפיצות בנקודת המבט בין דמויות בתוך סצנה.
- סיכום של רגעי שיא במקום סצנה, ומספר שמסביר את מה שהקורא כבר הבין (גם סמלים שמוסברים במפורש).
- זמן דקדוק שמחליק (הווה לעבר) בתוך אותו קטע.
- מילים חוזרות: "ובכן" בפתיחת דיאלוג, "באחת", "מיד", "לפתע".
- טעות עקבית: "שכחה" במקום "שככה".
- נטייה לסיים בגילוי מפתיע: לבדוק שבדיעבד הוא נראה בלתי נמנע.`

export const DEFAULT_KINDS: ReviewKind[] = [
  { id: 'plot', name: 'עלילה ומבנה', on: true, prompt: 'מבנה וסיבתיות, מתח, חורים בעלילה, דברים שהובטחו ולא קוימו, האם הסוף מרגיש בלתי נמנע בדיעבד, מה מקבל סצנה ומה מקבל סיכום.' },
  { id: 'characters', name: 'דמויות', on: true, prompt: 'עקביות הדמויות (מה הן יודעות, איפה הן נמצאות, איך הן מדברות), מניעים, קשת, דמויות שטוחות, קול נפרד לכל דמות.' },
  { id: 'pov', name: 'נקודת מבט', on: true, prompt: 'משמעת של נקודת מבט: קפיצות לראש של דמות אחרת בתוך סצנה, מספר שיודע או מסביר יותר ממה שצריך.' },
  { id: 'style', name: 'סגנון והרגלים', on: true, prompt: 'פרוזה וקול: תגובות גוף גנריות, "להראות ולא לספר", סמלים שמוסברים, קלישאות, מילים חוזרות וטיקים, משלב (מילה עכשווית בתוך עברית גבוהה), משפטים מסורבלים.' },
  { id: 'pace', name: 'קצב', prompt: 'קטעים שמתעכבים או רצים מהר מדי, איזון בין דיאלוג, תיאור ופעולה, רגעי שיא שמסוכמים במקום להיכתב כסצנה.' },
  { id: 'dialogue', name: 'דיאלוג', prompt: 'טבעיות, תגיות דיבור, מידע שנמסר באופן מלאכותי, האם כל הדמויות מדברות אותו דבר.' },
  { id: 'time', name: 'רצף וזמנים', prompt: 'רצף הזמנים בסיפור (סדר אירועים, גילים, עונות, טעויות המשכיות) וגם זמן הדקדוק: הווה שמחליק לעבר בתוך אותו קטע.' },
  { id: 'language', name: 'אחידות לשונית', prompt: 'אחידות בשמות, במונחים ובכתיב (מלא/חסר, ניקוד), מין דקדוקי, פנייה ביחיד/ברבים, מקף עברי.' },
  { id: 'proof', name: 'הגהה', on: true, prompt: 'טעויות הקלדה, דקדוק, מירכאות וסוגריים חסרים, מילים תועות. כל אחת עם התיקון בשדה ההצעה.' },
  { id: 'translation', name: 'תרגום', prompt: 'מול המקור, משפט מול משפט: טעויות משמעות, השמטות ותוספות, ניואנס ואירוניה שאבדו, משלב וקול הדמויות, מונחים לפי המילון. בכל הערה לציין גם את המקור בשדה ההערה ולהציע תרגום.' }
]

export const DEFAULT_AI: AiSettings = { model: DEFAULT_MODEL, effort: 'high', instructions: DEFAULT_INSTRUCTIONS, kinds: DEFAULT_KINDS }

export function normalizeAi(raw: Partial<AiSettings> | undefined): AiSettings {
  const r = raw ?? {}
  const model = MODELS.some((m) => m.id === r.model) ? (r.model as ModelId) : DEFAULT_MODEL
  const effort = EFFORTS.some((e) => e.id === r.effort) ? (r.effort as Effort) : DEFAULT_AI.effort
  const kinds = Array.isArray(r.kinds) ? r.kinds.filter((k) => k && typeof k.name === 'string' && k.name.trim()).map((k) => ({ id: String(k.id || newId()), name: k.name, prompt: String(k.prompt ?? ''), on: !!k.on })) : DEFAULT_KINDS
  return { model, effort, instructions: typeof r.instructions === 'string' ? r.instructions : DEFAULT_INSTRUCTIONS, kinds }
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

// ---------------------------------------------------------------------------
// A review
// ---------------------------------------------------------------------------

export type ReviewScope = 'selection' | 'chapter' | 'book' | 'exercise'
export type FindingStatus = 'open' | 'done' | 'dismissed'

export interface Finding {
  id: string
  /** The review kind's name (עלילה, דמויות…), or "כללי" / "מה עובד" */
  kind: string
  /** The exact words in the text the comment is about (may be empty for a general comment) */
  quote: string
  comment: string
  /** A fix or a direction ("← מחככת"), when there is one */
  suggestion?: string
  /** For a whole-book review: which chapter the quote is in */
  chapterId?: string
  status: FindingStatus
  /** The writer's conversation with Claude about this one comment */
  thread?: ChatTurn[]
  /** What was decided about this comment, in one line (Claude sums it up after a reply; the writer can edit it) */
  decision?: string
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface Usage {
  input: number
  output: number
  /** US dollars, estimated from the model's prices */
  cost: number
}

export interface Review {
  id: string
  at: number
  scope: ReviewScope
  /** The chapter (scope chapter / selection) or exercise reviewed */
  targetId?: string
  /** What was reviewed, for the list: chapter title, "כל הספר", exercise title */
  title: string
  kinds: string[]
  question?: string
  /** For a selection: the selected words (so a follow-up question knows what was reviewed) */
  excerpt?: string
  /** The original (PDF) of translated chapters was sent along */
  withSource?: boolean
  /** Earlier reviews (with their decisions) were sent along, so this one builds on them */
  withHistory?: boolean
  model: string
  summary: string
  findings: Finding[]
  /** "מה זה מלמד על הכתיבה שלך" */
  lessons?: string
  /** "מה הייתי עושה עכשיו" */
  next?: string
  chat: ChatTurn[]
  usage: Usage
}

export function costOf(model: string, input: number, output: number, cacheRead = 0, cacheWrite = 0): number {
  const m = MODELS.find((x) => x.id === model) ?? MODELS[0]
  return (input * m.input + cacheWrite * m.input * 1.25 + cacheRead * m.input * 0.1 + output * m.output) / 1_000_000
}

export function addUsage(a: Usage, b: Usage): Usage {
  return { input: a.input + b.input, output: a.output + b.output, cost: a.cost + b.cost }
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return 'פחות מסנט'
  return `$${usd.toFixed(2)}`
}

// ---------------------------------------------------------------------------
// The book's background (characters, places, research, glossary) as context for a review
// ---------------------------------------------------------------------------

export interface BgPage {
  kind: 'character' | 'place' | 'research'
  name: string
  aliases: string[]
  tags: string[]
  fields: { label: string; value: string }[]
  original?: string
  notes: string
}

const BG_KIND: Record<BgPage['kind'], string> = { character: 'דמות', place: 'מקום', research: 'מחקר' }

/** Background pages and glossary as one text, kept within a size so it does not crowd out the chapter */
export function backgroundText(pages: BgPage[], glossary: { term: string; original: string; variants: string[]; note: string }[], maxChars = 60000): string {
  const out: string[] = []
  for (const p of pages) {
    const lines = [`[${BG_KIND[p.kind]}] ${p.name}${p.aliases.length ? ` (גם: ${p.aliases.join(', ')})` : ''}${p.original ? ` · במקור: ${p.original}` : ''}`]
    if (p.tags.length) lines.push(`תוויות: ${p.tags.join(', ')}`)
    for (const f of p.fields) if (f.value.trim()) lines.push(`${f.label}: ${f.value.trim()}`)
    if (p.notes.trim()) lines.push(p.notes.trim())
    out.push(lines.join('\n'))
  }
  const terms = glossary.filter((g) => g.term.trim())
  if (terms.length)
    out.push(
      'מילון מונחים ושמות (הכתיב הנכון בספר):\n' +
        terms.map((g) => `- ${g.term}${g.original ? ` (במקור: ${g.original})` : ''}${g.variants.length ? `; כתיב שגוי: ${g.variants.join(', ')}` : ''}${g.note ? `; ${g.note}` : ''}`).join('\n')
    )
  let text = out.join('\n\n')
  if (text.length > maxChars) text = text.slice(0, maxChars) + '\n…(קוצר)'
  return text
}

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

/** One piece of text to review: a chapter (with its title) or an exercise */
export interface ReviewText {
  /** chapter id; empty for an exercise or a selection */
  id?: string
  title: string
  paras: string[]
  /** The original's paragraphs (a translated chapter with its PDF), to compare with */
  source?: string[]
}

export interface ReviewRequest {
  scope: ReviewScope
  /** Titles and text of what is reviewed */
  texts: ReviewText[]
  /** For a selection, the chapter it comes from (context) */
  contextTitle?: string
  /** Names of the review kinds picked, with their prompts */
  kinds: { name: string; prompt: string }[]
  question?: string
  /** Background pages and glossary, already as text */
  background?: string
  /** For an exercise: the exercise's prompt (what the writer was asked to write) */
  exercisePrompt?: string
  /** The book's title */
  bookTitle?: string
  /** Earlier reviews of the same text and what was decided in them, already as text (historyText) */
  history?: string
}

/** The JSON shape Claude answers in (structured outputs) */
export const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'בשורה התחתונה: 3-5 משפטים' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', description: 'סוג הביקורת שההערה שייכת אליו, אחד מהסוגים שנתבקשו, או "מה עובד" או "כללי"' },
          quote: { type: 'string', description: 'ציטוט מדויק, מילה במילה, של כמה מילים רצופות מהטקסט (עד משפט אחד) שההערה מתייחסת אליהן. ריק אם ההערה כללית' },
          chapter: { type: 'string', description: 'מספר הפרק כפי שמופיע בכותרת <פרק מספר="..."> שבו נמצא הציטוט. ריק אם יש רק טקסט אחד' },
          comment: { type: 'string', description: 'ההערה עצמה: מה עובד או מה הבעיה ולמה' },
          suggestion: { type: 'string', description: 'תיקון מוצע או כיוון (למשל: "מחככת, כשהיא חושבת"). ריק אם אין' }
        },
        required: ['kind', 'quote', 'chapter', 'comment', 'suggestion'],
        additionalProperties: false
      }
    },
    lessons: { type: 'string', description: 'מה זה מלמד על הכתיבה שלך: דפוסים, חוזקות והרגלים, 2-4 שורות. ריק בביקורת על קטע קצר מאוד' },
    next: { type: 'string', description: 'מה הייתי עושה עכשיו: הצעד הבא, משפט או שניים' }
  },
  required: ['summary', 'findings', 'lessons', 'next'],
  additionalProperties: false
} as const

const esc = (s: string) => s.replace(/</g, '‹').replace(/>/g, '›')

export function textBlock(texts: ReviewText[]): string {
  return texts
    .map((t, i) => {
      const src = t.source?.length ? `<מקור>\n${t.source.join('\n')}\n</מקור>\n<תרגום>\n${t.paras.join('\n')}\n</תרגום>` : t.paras.join('\n')
      return texts.length > 1 ? `<פרק מספר="${i + 1}" כותרת="${esc(t.title)}">\n${src}\n</פרק>` : `<טקסט כותרת="${esc(t.title)}">\n${src}\n</טקסט>`
    })
    .join('\n\n')
}

/** The system prompt: the writer's instructions plus how to answer */
export function systemPrompt(instructions: string): string {
  return `${instructions.trim() || DEFAULT_INSTRUCTIONS}

---
אתה עובד בתוך "הכריכייה", מעבד תמלילים לכתיבת ספרים. הכותב מבקש ביקורת על טקסט שלו.
כל ציטוט בשדה quote חייב להיות העתקה מדויקת של מילים רצופות מהטקסט, כולל ניקוד ופיסוק אם יש, כדי שהתוכנה תמצא אותו ותקפוץ אליו. אל תצטט מחומרי הרקע או מהמקור: כשיש <מקור> ו<תרגום>, הציטוט הוא תמיד מהתרגום, והמקור נכתב בתוך ההערה.
ההערות על "מה עובד" נכתבות כהערות מסוג "מה עובד". סדר את ההערות כמו בביקורת: קודם "מה עובד", אחר כך מה שצריך עבודה לפי החשיבות, והגהה בסוף.`
}

/** The user message: the context first (stays the same between questions, so it can be cached), then the ask */
export function reviewMessage(req: ReviewRequest): { context: string; ask: string } {
  const parts: string[] = []
  if (req.bookTitle) parts.push(`שם הספר: ${req.bookTitle}`)
  if (req.background?.trim()) parts.push(`<חומרי_רקע>\n${req.background.trim()}\n</חומרי_רקע>`)
  if (req.history?.trim()) parts.push(`<ביקורות_קודמות>\n${req.history.trim()}\n</ביקורות_קודמות>`)
  if (req.exercisePrompt?.trim()) parts.push(`<הנחיית_התרגיל>\n${req.exercisePrompt.trim()}\n</הנחיית_התרגיל>`)
  const what = req.scope === 'book' ? 'כל הספר, פרק אחרי פרק' : req.scope === 'selection' ? `קטע מסומן${req.contextTitle ? ` מתוך "${req.contextTitle}"` : ''}` : req.scope === 'exercise' ? 'תרגיל כתיבה' : 'פרק'
  parts.push(`הטקסט לביקורת (${what}):\n${textBlock(req.texts)}`)
  const asks: string[] = []
  if (req.kinds.length) asks.push(`בדוק את הטקסט לפי הסוגים האלה:\n${req.kinds.map((k) => `- ${k.name}: ${k.prompt}`).join('\n')}`)
  if (req.history?.trim()) asks.push(HISTORY_ASK)
  if (req.exercisePrompt?.trim()) asks.push('התייחס גם לשאלה עד כמה הטקסט עונה על הנחיית התרגיל.')
  if (req.question?.trim()) asks.push(`שאלה מהכותב: ${req.question.trim()}`)
  if (!asks.length) asks.push('תן ביקורת כללית על הטקסט.')
  asks.push('ענה במבנה המבוקש: סיכום קצר ורשימת הערות, כל הערה עם ציטוט מדויק מהטקסט.')
  return { context: parts.join('\n\n'), ask: asks.join('\n\n') }
}

/** What Claude is asked to do with earlier reviews */
export const HISTORY_ASK = `לפני הטקסט יש <ביקורות_קודמות>: ביקורות שכבר נתת על הטקסט הזה, מה הכותב עשה עם כל הערה ומה הוחלט בשיחות עליהן. בנה עליהן:
- מה שהכותב החליט לגביו (למשל להשאיר משהו כמו שהוא, כי הוא מכוון) הוא החלטה שלו. אל תעלה את זה שוב, אלא אם יש סיבה חדשה וממשית, ואז אמור במפורש שזה חוזר ולמה.
- הערה שסומנה "לא רלוונטי" לא חוזרת באותה צורה.
- הערה שסומנה "טופל": בדוק אם התיקון באמת עובד, ואם כן אפשר לציין שזה השתפר.
- הערה שנשארה פתוחה ועדיין נכונה: אפשר להזכיר אותה בקצרה ולציין שהיא עדיין פתוחה.
- בשורה התחתונה, אמור גם מה השתנה מאז הביקורת הקודמת.`

// ---------------------------------------------------------------------------
// Earlier reviews as context for a new one
// ---------------------------------------------------------------------------

const STATUS_WORD: Record<FindingStatus, string> = { open: 'פתוח', done: 'טופל', dismissed: 'לא רלוונטי' }

/** Which earlier reviews a new review of this target builds on: the same chapter (or exercise), whole-book reviews, and for a whole-book review all of them. Newest first. */
export function relevantReviews(list: Review[], target: { scope: ReviewScope; targetId?: string }, before = Infinity): Review[] {
  return list
    .filter((r) => r.at < before)
    .filter((r) => {
      if (target.scope === 'book' || target.scope === 'exercise') return true
      if (r.scope === 'book') return r.findings.some((f) => f.chapterId === target.targetId)
      return r.targetId === target.targetId
    })
    .sort((a, b) => b.at - a.at)
}

function dateWord(ts: number): string {
  const d = new Date(ts)
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`
}

/**
 * Earlier reviews as text: each review's summary, every comment with what the writer did with it, what
 * was decided and the talk about it. For a chapter, comments of a whole-book review about other chapters
 * are left out. Newest first, cut at maxChars (older reviews drop off first).
 */
export function historyText(reviews: Review[], target: { scope: ReviewScope; targetId?: string }, chapterTitle: (id?: string) => string | undefined = () => undefined, maxChars = 40000): string {
  const out: string[] = []
  let used = 0
  for (const r of reviews) {
    const findings = target.scope === 'chapter' || target.scope === 'selection' ? r.findings.filter((f) => r.scope !== 'book' || f.chapterId === target.targetId) : r.findings
    const lines = [`<ביקורת תאריך="${dateWord(r.at)}" על="${esc(r.title)}">`]
    if (r.question) lines.push(`שאלת הכותב: ${r.question}`)
    if (r.excerpt) lines.push(`(ביקורת על קטע: "${r.excerpt.slice(0, 200)}${r.excerpt.length > 200 ? '…' : ''}")`)
    if (r.summary) lines.push(`בשורה התחתונה: ${r.summary}`)
    for (const f of findings) {
      const where = r.scope === 'book' && target.scope === 'book' && chapterTitle(f.chapterId) ? ` (${chapterTitle(f.chapterId)})` : ''
      lines.push(`- [${f.kind}${where}] ${f.quote ? `"${f.quote}": ` : ''}${f.comment}${f.suggestion ? ` ← ${f.suggestion}` : ''}`)
      if (f.kind !== 'מה עובד' || f.status !== 'open') lines.push(`  מצב: ${STATUS_WORD[f.status]}`)
      if (f.decision?.trim()) lines.push(`  הוחלט: ${f.decision.trim()}`)
      for (const t of f.thread ?? []) lines.push(`  ${t.role === 'user' ? 'הכותב' : 'אתה'}: ${t.text.replace(/\s*\n\s*/g, ' ')}`)
    }
    if (r.next) lines.push(`מה הייתי עושה עכשיו: ${r.next}`)
    if (r.chat.length) {
      lines.push('שיחה על הביקורת:')
      for (const t of r.chat) lines.push(`  ${t.role === 'user' ? 'הכותב' : 'אתה'}: ${t.text.replace(/\s*\n\s*/g, ' ')}`)
    }
    lines.push('</ביקורת>')
    const block = lines.join('\n')
    if (used + block.length > maxChars) {
      if (!out.length) out.push(block.slice(0, maxChars) + '\n…(קוצר)')
      break
    }
    out.push(block)
    used += block.length
  }
  return out.join('\n\n')
}

// ---------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------

/** Turns Claude's JSON into findings. Chapter numbers become chapter ids. */
export function parseReview(json: string, texts: ReviewText[]): { summary: string; findings: Finding[]; lessons?: string; next?: string } {
  let raw: { summary?: unknown; findings?: unknown; lessons?: unknown; next?: unknown }
  try {
    raw = JSON.parse(json)
  } catch {
    // not JSON after all: keep the words as the summary
    return { summary: json.trim(), findings: [] }
  }
  const list = Array.isArray(raw.findings) ? raw.findings : []
  const findings: Finding[] = []
  for (const f of list) {
    if (!f || typeof f !== 'object') continue
    const o = f as Record<string, unknown>
    const comment = String(o.comment ?? '').trim()
    if (!comment) continue
    const quote = String(o.quote ?? '').trim()
    let chapterId: string | undefined
    const n = parseInt(String(o.chapter ?? ''), 10)
    if (texts.length > 1 && n >= 1 && n <= texts.length) chapterId = texts[n - 1].id
    else if (texts.length === 1) chapterId = texts[0].id
    // the model got the chapter wrong: look for the quote in every chapter
    if (quote && texts.length > 1 && (!chapterId || !findQuote(texts.find((t) => t.id === chapterId)?.paras ?? [], quote))) {
      const hit = texts.find((t) => findQuote(t.paras, quote))
      if (hit) chapterId = hit.id
    }
    const suggestion = String(o.suggestion ?? '').trim()
    findings.push({ id: newId(), kind: String(o.kind ?? 'כללי').trim() || 'כללי', quote, comment, ...(suggestion ? { suggestion } : {}), chapterId: chapterId || undefined, status: 'open' })
  }
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  return { summary: str(raw.summary) ?? '', findings, lessons: str(raw.lessons), next: str(raw.next) }
}

/** How many findings a JSON answer has so far, while it is still being written */
export function findingsSoFar(partial: string): number {
  return (partial.match(/"comment"\s*:/g) ?? []).length
}

// ---------------------------------------------------------------------------
// Finding a quote in the text, despite small differences (spaces, quote marks, niqqud)
// ---------------------------------------------------------------------------

const NIQQUD = /[֑-ׇ]/g
const fold = (ch: string) => (/["״“”„]/.test(ch) ? '"' : /['׳‘’`]/.test(ch) ? "'" : /[-־–—]/.test(ch) ? '-' : ch)

/** The text without niqqud, with one kind of quote mark and single spaces, and where each character came from */
export function foldText(s: string): { text: string; map: number[] } {
  let text = ''
  const map: number[] = []
  let space = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (NIQQUD.test(ch)) {
      NIQQUD.lastIndex = 0
      continue
    }
    NIQQUD.lastIndex = 0
    if (/\s/.test(ch)) {
      if (space || text === '') continue
      space = true
      text += ' '
      map.push(i)
      continue
    }
    space = false
    text += fold(ch)
    map.push(i)
  }
  if (text.endsWith(' ')) (text = text.slice(0, -1)), map.pop()
  return { text, map }
}

export interface QuoteHit {
  para: number
  start: number
  end: number
}

/** Where a quote is: paragraph and character range. Tries the whole quote, then its longest part. */
export function findQuote(paras: string[], quote: string): QuoteHit | null {
  const q = foldText(quote.replace(/^["״“”'׳\s.…]+|["״“”'׳\s.…]+$/g, '')).text
  if (q.length < 2) return null
  const folded = paras.map(foldText)
  const look = (needle: string): QuoteHit | null => {
    for (let p = 0; p < folded.length; p++) {
      const i = folded[p].text.indexOf(needle)
      if (i >= 0) {
        const { map } = folded[p]
        return { para: p, start: map[i], end: map[i + needle.length - 1] + 1 }
      }
    }
    return null
  }
  const whole = look(q)
  if (whole) return whole
  // a quote that runs over a paragraph break, or was shortened with "…": try its pieces, longest first
  const pieces = q
    .split(/\s*(?:\.\.\.|…)\s*|\s*\/\s*/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 6)
    .sort((a, b) => b.length - a.length)
  for (const piece of pieces) {
    const hit = look(piece)
    if (hit) return hit
  }
  // the first words only (the model changed something near the end)
  const words = q.split(' ')
  for (let n = Math.min(words.length - 1, 8); n >= 4; n--) {
    const hit = look(words.slice(0, n).join(' '))
    if (hit) return hit
  }
  return null
}

// ---------------------------------------------------------------------------
// Follow-up questions
// ---------------------------------------------------------------------------

/** The review so far as text, for a follow-up question */
export function reviewAsText(r: Pick<Review, 'summary' | 'findings' | 'lessons' | 'next'>): string {
  const lines = [`בשורה התחתונה: ${r.summary}`]
  for (const f of r.findings) lines.push(`- [${f.kind}] ${f.quote ? `"${f.quote}": ` : ''}${f.comment}${f.suggestion ? ` ← ${f.suggestion}` : ''}`)
  if (r.lessons) lines.push(`מה זה מלמד: ${r.lessons}`)
  if (r.next) lines.push(`מה הייתי עושה עכשיו: ${r.next}`)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// A conversation about one comment
// ---------------------------------------------------------------------------

/** Claude's answer to the writer's reply on one comment: the answer, and what is decided so far */
export const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string', description: 'התשובה לכותב, בטקסט רגיל, בקצרה ולעניין' },
    decision: {
      type: 'string',
      description:
        'מה הוחלט לגבי ההערה עד עכשיו, במשפט אחד קצר, כפי שהכותב היה רושם לעצמו (למשל: "משאיר את ההסמקה, היא מכוונת" או "מוחק את המשפט המסביר"). ריק אם עוד לא הוחלט כלום'
    }
  },
  required: ['reply', 'decision'],
  additionalProperties: false
} as const

/** One comment as text, to open a conversation about it */
export function findingAsText(f: Pick<Finding, 'kind' | 'quote' | 'comment' | 'suggestion'>): string {
  return `[${f.kind}] ${f.quote ? `"${f.quote}": ` : ''}${f.comment}${f.suggestion ? ` ← ${f.suggestion}` : ''}`
}

/** The writer's turns about a comment as messages: the first one carries the comment it is about */
export function findingThreadMessages(f: Pick<Finding, 'kind' | 'quote' | 'comment' | 'suggestion' | 'decision'>, thread: ChatTurn[], message: string): ChatTurn[] {
  const turns: ChatTurn[] = [...thread, { role: 'user', text: message }]
  const lead = `הכותב מגיב על אחת ההערות שלך:\n${findingAsText(f)}${f.decision?.trim() ? `\n(הוחלט עד עכשיו: ${f.decision.trim()})` : ''}\n\nהתגובה שלו:\n`
  const tail =
    '\n\n(ענה לו על ההערה הזו בלבד, כמו עורך שמדבר עם כותב: אם הוא צודק או מסביר שזה מכוון, קבל את זה; אם לא, הסבר בכנות למה ההערה עדיין נכונה, ואפשר להציע דרך שלישית. בשדה decision רשום מה הוחלט עד עכשיו.)'
  return turns.map((t, i) => (i === 0 ? { ...t, text: lead + t.text } : t)).map((t, i, all) => (i === all.length - 1 ? { ...t, text: t.text + tail } : t))
}

/** Reads Claude's answer about a comment. Not JSON: the words are the answer, nothing decided. */
export function parseReply(json: string): { reply: string; decision: string } {
  try {
    const o = JSON.parse(json)
    return { reply: String(o?.reply ?? '').trim(), decision: String(o?.decision ?? '').trim() }
  } catch {
    return { reply: json.trim(), decision: '' }
  }
}

/** The answer's words while it is still being written (the JSON is not finished yet) */
export function partialReply(partial: string): string {
  const m = /"reply"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(partial)
  if (!m) return ''
  let body = m[1]
  for (let cut = 0; cut < 6; cut++) {
    try {
      return JSON.parse(`"${body}"`)
    } catch {
      body = body.slice(0, -1) // a half-written escape at the end
    }
  }
  return ''
}

// ---------------------------------------------------------------------------
// The workshop (feature 22)
// ---------------------------------------------------------------------------

/** A writing prompt waiting to be written: from the writer, imported, or suggested by Claude */
export interface ExercisePrompt {
  id: string
  text: string
  /** Where it came from: 'mine' | 'claude' | 'import' */
  source: 'mine' | 'claude' | 'import'
  at: number
}

export interface Exercise {
  id: string
  title: string
  /** What the writer was asked to write */
  prompt: string
  /** Word file name inside the workshop's "תרגילים" folder */
  file: string
  created: number
  updated: number
  words: number
  reviews: Review[]
}

export interface Workshop {
  path: string
  exercises: Exercise[]
  prompts: ExercisePrompt[]
}

export const WORKSHOP_FILE = 'סדנה.json'
export const EXERCISES_DIR = 'תרגילים'

/** Splits pasted text into prompts: one per paragraph or numbered/bulleted line */
export function splitPrompts(text: string): string[] {
  const lines = text.split(/\r?\n/)
  const out: string[] = []
  let cur: string[] = []
  const flush = () => {
    const t = cur.join(' ').trim()
    if (t) out.push(t)
    cur = []
  }
  for (const line of lines) {
    const t = line.trim()
    if (!t) {
      flush()
      continue
    }
    const bullet = /^(?:\d+[.)]|[-*•])\s+/.exec(t)
    if (bullet) {
      flush()
      cur.push(t.slice(bullet[0].length))
    } else cur.push(t)
  }
  flush()
  return out
}

/** Asks Claude for new writing prompts */
export function promptIdeasMessage(theme: string, count: number, avoid: string[]): string {
  return `הצע ${count} תרגילי כתיבה קצרים לכותב פרוזה בעברית${theme.trim() ? `, בנושא או במיקוד הזה: ${theme.trim()}` : ''}.
כל תרגיל במשפט או שניים: מה לכתוב, ואילוצים אם יש (נקודת מבט, אורך, מגבלה).
${avoid.length ? `אל תחזור על התרגילים האלה:\n${avoid.slice(0, 30).map((a) => `- ${a}`).join('\n')}\n` : ''}ענה ברשימה בלבד, תרגיל בכל שורה, בלי מספור ובלי הקדמה.`
}

/** A title for an exercise from its prompt: the first words */
export function titleFromPrompt(prompt: string): string {
  const words = prompt.trim().split(/\s+/).slice(0, 6).join(' ')
  return words.replace(/[.,:;!?]+$/, '') || 'תרגיל'
}
