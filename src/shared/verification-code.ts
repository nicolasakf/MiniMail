/**
 * Finding a one-time code (OTP, 2FA, "confirm your email" PIN) in the text of an email.
 *
 * This is the cheap, local first pass: no network, no model. Every number-like token is scored
 * by the words around it ("your verification code is 123456"), and one is accepted only when
 * it clearly beats the rest. Anything unclear returns null so a model can take a look instead.
 * The same file holds the checks that keep a model's answer honest.
 */

/** Id of the built-in category that holds sign-in and verification mail. */
export const VERIFICATION_CATEGORY_ID = "verification-codes";

/**
 * The model that reads verification mail the local rules could not. Any Vercel AI Gateway
 * language model id works; the user can change it (or clear it to use rules only) in settings.
 */
export const DEFAULT_CODE_MODEL = "reflection/beam";

/** What a gateway model id looks like ("provider/model"); empty is allowed and means "rules only". */
export const CODE_MODEL_PATTERN = /^$|^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;

/** Codes expire within minutes; older mail gets no chip and is never sent to a model. */
export const MAX_CODE_AGE_MS = 60 * 60 * 1000;

/** How much of the body a model may see. A code sits near the top of the message. */
export const MODEL_TEXT_CHARS = 1500;

export interface CodeSource {
  subject: string;
  /** Plain text of the body (use `htmlToText` when only HTML exists). */
  text: string;
}

/** Whether a message is recent enough for its code to still be worth showing. */
export function isFreshForCode(isoDate: string, now: number = Date.now()): boolean {
  const sent = Date.parse(isoDate);
  return Number.isFinite(sent) && now - sent <= MAX_CODE_AGE_MS && sent <= now + 5 * 60 * 1000;
}

/** Words that announce a code, in the languages mail most often arrives in. */
const CODE_WORDS =
  /\b(?:codes?|c[óo]digos?|code|kode|otp|pin|passcode|password|senha|verification|verify|verifica\w*|v[ée]rification|v[ée]rifi\w*|best[äa]tigung\w*|one[- ]time|single[- ]use|2fa|token|security|seguran[çc]a|s[ée]curit[ée]|sign[- ]?in|log[- ]?in|login|authenticat\w*|autentica\w*)\b/i;

/** Words that mean a nearby number is something else: an order, an amount, a phone number. */
const OTHER_NUMBER_WORDS =
  /\b(?:order|pedido|invoice|fatura|nota|tracking|rastreio|zip|postal|cep|phone|tel|telefone|call|ligue|ref(?:erence)?|refer[êe]ncia|amount|total|price|valor|account|conta|card|cart[ãa]o|id)\b/i;

const UNIT_AFTER = /^\s*(?:%|min(?:ute)?s?\b|minutos?\b|hours?\b|horas?\b|days?\b|dias?\b|usd\b|brl\b|eur\b|gbp\b)/i;
const SYMBOL_BEFORE = /(?:[$€£#+]|r\$)\s?$/i;

interface Candidate {
  /** The code as it would be typed: separators removed. */
  code: string;
  start: number;
  end: number;
}

/** Each pattern's first capture group (or the whole match) is the code. */
const PATTERNS: readonly RegExp[] = [
  // Google style: G-123456 (the letter is a label, the digits are the code).
  /(?<![\w-])[A-Z]-(\d{4,8})(?![\w-])/g,
  // Grouped digits: 123-456 or 1234 5678.
  /(?<![\w-])(\d{3})[ -](\d{3})(?![\w-])/g,
  /(?<![\w-])(\d{4})[ -](\d{4})(?![\w-])/g,
  // Plain digits.
  /(?<![\w-])\d{4,8}(?![\w-])/g,
  // Mixed capitals and digits, such as A1B2C3.
  /(?<![\w-])(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{5,8}(?![\w-])/g,
];

/** Blanks out links so a token inside a URL is never mistaken for a code; indexes stay valid. */
function blankLinks(text: string): string {
  return text.replace(/(?:https?:\/\/|www\.)\S+/gi, (match) => " ".repeat(match.length));
}

function findCandidates(text: string): Candidate[] {
  const found: Candidate[] = [];
  const taken: Array<[number, number]> = [];
  for (const pattern of PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (taken.some(([from, to]) => start < to && end > from)) continue;
      taken.push([start, end]);
      const digits = match.slice(1).join("");
      found.push({ code: digits.length > 0 ? digits : match[0], start, end });
    }
  }
  return found;
}

function scoreCandidate(text: string, subjectLength: number, candidate: Candidate): number {
  const before = text.slice(Math.max(0, candidate.start - 60), candidate.start);
  const after = text.slice(candidate.end, candidate.end + 50);
  const lineStart = text.lastIndexOf("\n", candidate.start - 1) + 1;
  const lineEndAt = text.indexOf("\n", candidate.end);
  const line = text.slice(lineStart, lineEndAt < 0 ? text.length : lineEndAt).trim();
  const raw = text.slice(candidate.start, candidate.end);

  let score = 0;
  if (CODE_WORDS.test(before)) {
    score += 3;
    // "code: 123456" beats "enter the code below, and by the way 4821".
    if (CODE_WORDS.test(before.slice(-28))) score += 1;
  } else if (CODE_WORDS.test(after.slice(0, 40))) {
    score += 3;
  }
  if (line === raw) score += 2;
  if (candidate.start < subjectLength) score += 1;

  if (SYMBOL_BEFORE.test(before)) score -= 4;
  if (UNIT_AFTER.test(after)) score -= 4;
  if (OTHER_NUMBER_WORDS.test(before.slice(-25))) score -= 3;
  // A bare year is far more likely a date than a code.
  if (/^(?:19|20)\d{2}$/.test(candidate.code) && !CODE_WORDS.test(before.slice(-28))) score -= 2;
  return score;
}

/** A candidate needs the words of a code around it; position and shape alone are not enough. */
const MIN_SCORE = 3;

/**
 * The verification code in an email, or null when there is none or it is not clear which
 * number it is (a model can be asked then).
 */
export function extractVerificationCode(source: CodeSource): string | null {
  const subject = source.subject.replace(/\s+/g, " ").trim();
  const text = blankLinks(`${subject}\n${source.text}`);
  const scored = findCandidates(text)
    .map((candidate) => ({ candidate, score: scoreCandidate(text, subject.length, candidate) }))
    .filter(({ score }) => score >= MIN_SCORE);
  if (scored.length === 0) return null;

  // The same code shown twice (subject and body) is one candidate with its best score.
  const best = new Map<string, number>();
  for (const { candidate, score } of scored) {
    best.set(candidate.code, Math.max(best.get(candidate.code) ?? 0, score));
  }
  const ranked = [...best].sort((a, b) => b[1] - a[1]);
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return null;
  return ranked[0][0];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** A rough HTML to text conversion, good enough to read a short transactional email. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(?:p|div|tr|td|th|li|h[1-6]|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (name.startsWith("#")) {
        const point = Number(name.slice(1));
        return point > 0 && point < 0x110000 ? String.fromCodePoint(point) : " ";
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    })
    .replace(/[ \t\r\f ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Link paths and queries carry magic-link tokens; a model only needs to know a link was there. */
export function maskLinks(text: string): string {
  return text.replace(/https?:\/\/([^\s/<>"')]+)[^\s<>"')]*/gi, "[link $1]");
}

/** What a model is shown: the start of the body with links masked, whitespace tidied. */
export function textForModel(text: string): string {
  return maskLinks(text).replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim().slice(0, MODEL_TEXT_CHARS);
}

function squash(value: string): string {
  return value.replace(/[\s-]/g, "");
}

/**
 * Accepts a model's answer only when it looks like a code and really is in the email. A wrong
 * code is worse than none, so a made-up or altered answer is dropped.
 */
export function confirmedCode(answer: string | null | undefined, source: CodeSource): string | null {
  if (!answer) return null;
  const code = squash(answer);
  if (!/^[A-Za-z0-9]{4,10}$/.test(code)) return null;
  const haystack = squash(`${source.subject}\n${source.text}`);
  return haystack.includes(code) ? code : null;
}
