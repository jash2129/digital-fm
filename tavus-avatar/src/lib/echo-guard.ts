/**
 * Speaker-echo guard (follow-up 10, live call d4711cfb on laptop speakers).
 *
 * Chrome Web Speech opens its own microphone, so the echoCancellation constraint on our
 * getUserMedia stream never reaches it: Max's voice from the speakers comes back as "the customer"
 * ("can you hear and see me all right", "would you like me"). These checks run on the text instead.
 *
 * Client-safe: no server imports.
 */

const ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
const TENS = "  twenty thirty forty fifty sixty seventy eighty ninety".split(" ");

function numberToWords(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return n % 10 ? `${TENS[Math.floor(n / 10)]} ${ONES[n % 10]}` : TENS[n / 10];
  return String(n);
}

/**
 * The form both sides are compared in: lowercase, no punctuation, "all right" -> "alright",
 * "ok" -> "okay", "mm hm" -> "mhm", numbers 0-99 as words, repeated words collapsed.
 */
export function normalizeSpeech(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/(\d+)\.(\d+)/g, "$1 point $2")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b\d{1,2}\b/g, (d) => numberToWords(Number(d)))
    .replace(/\ball right\b/g, "alright")
    .replace(/\bok\b/g, "okay")
    .replace(/\b(mm+ ?h+m+|m+ ?hm+|mhm+|mm+ ?hmm+|uh huh)\b/g, "mhm")
    .split(/\s+/)
    .filter(Boolean);
  return words.filter((w, i) => w !== words[i - 1]).join(" ");
}

const wordsOf = (text: string) => normalizeSpeech(text).split(" ").filter(Boolean);

/**
 * A long transcript that is (almost) word for word something Max just said. Short human replies
 * (1-3 words) are never caught here; the fragment rule below handles short echoes, with timing.
 */
export function isNearExactEcho(userTranscript: string, recentAvatarSources: string | Array<string | { text: string }>): boolean {
  if (!userTranscript) return false;
  const userWords = wordsOf(userTranscript);
  if (userWords.length < 4) return false;
  const userClean = userWords.join(" ");

  const sources = (Array.isArray(recentAvatarSources) ? recentAvatarSources : [recentAvatarSources])
    .map((s) => (typeof s === "string" ? s : s?.text || ""))
    .filter(Boolean);

  for (const src of sources) {
    const avatarWords = wordsOf(src);
    if (avatarWords.length === 0) continue;
    // Exact phrase match: at least 5 consecutive identical words
    if (userWords.length >= 5 && avatarWords.join(" ").includes(userClean)) return true;
    // High word overlap: >= 80% of 5+ user words are Max's words
    if (userWords.length >= 5) {
      const avatarSet = new Set(avatarWords);
      const matchCount = userWords.filter((w) => avatarSet.has(w)).length;
      if (matchCount / userWords.length >= 0.8 && matchCount >= 4) return true;
    }
  }
  return false;
}

/**
 * A run of 2+ consecutive words from one of Max's recent lines, with no word he did not say
 * ("would you like me" after "Would you like me to continue, or go over that again?").
 * Timing is checked separately (EchoTimeline): this only answers "could these words be his?".
 */
export function isMaxWordRun(transcript: string, maxLines: string[]): boolean {
  const user = wordsOf(transcript);
  if (user.length < 2) return false;
  const run = ` ${user.join(" ")} `;
  return maxLines.some((line) => ` ${wordsOf(line).join(" ")} `.includes(run));
}

/** How long after Max stops that his own voice can still arrive as a transcript */
export const ECHO_TAIL_MS = 3000;

/** When Max's voice was coming out of the speakers, so late finals are judged by when speech started. */
export class EchoTimeline {
  private intervals: Array<{ start: number; end: number | null }> = [];

  maxStarted(at = Date.now()): void {
    const last = this.intervals.at(-1);
    if (last && last.end === null) return;
    this.intervals.push({ start: at, end: null });
    if (this.intervals.length > 20) this.intervals.shift();
  }

  maxStopped(at = Date.now()): void {
    const last = this.intervals.at(-1);
    if (last && last.end === null) last.end = at;
  }

  /** Was Max speaking at `at`, or had he stopped less than ECHO_TAIL_MS before it? */
  maxAudibleAt(at: number): boolean {
    return this.intervals.some((i) => at >= i.start && (i.end === null || at <= i.end + ECHO_TAIL_MS));
  }
}

/** A recognizer result after this long a gap starts a new utterance */
export const UTTERANCE_GAP_MS = 2000;

/**
 * When the current utterance STARTED: the recognizer's speech-start event, or the first result after
 * a gap. Finals arrive 2-5 s after the words were spoken, so this, not their arrival, says whether
 * the customer was talking over Max.
 */
export class UtteranceClock {
  private startAt: number | null = null;
  private lastAt = 0;
  // The first result after a speech-start event can take 5 s (live call: 5.4 s): it belongs to it
  private awaitingFirstResult = false;

  speechStarted(at = Date.now()): void {
    this.startAt = at;
    this.lastAt = at;
    this.awaitingFirstResult = true;
  }

  /** A result arrived; returns when its utterance started */
  result(at = Date.now()): number {
    const gap = at - this.lastAt > UTTERANCE_GAP_MS;
    if (this.startAt === null || (gap && !this.awaitingFirstResult)) this.startAt = at;
    this.awaitingFirstResult = false;
    this.lastAt = at;
    return this.startAt;
  }

  /** The utterance was handled (or a new Max line began): the next result starts a new one */
  reset(): void {
    this.startAt = null;
    this.awaitingFirstResult = false;
  }
}

export type EchoVerdict = { echo: false } | { echo: true; reason: "avatar_echo" | "echo_fragment" };

/**
 * The full check for one customer transcript.
 *  - avatar_echo: near-exact copy of one of Max's recent lines (any timing)
 *  - echo_fragment: a 2+ word run of Max's last 2 lines that STARTED while Max was audible (speaking,
 *    or within 3 s after). Judged by speechStartAt, not by when the late final arrived.
 */
export function checkEcho(
  transcript: string,
  opts: { recentMaxLines: string[]; speechStartAt: number; timeline: EchoTimeline }
): EchoVerdict {
  if (isNearExactEcho(transcript, opts.recentMaxLines)) return { echo: true, reason: "avatar_echo" };
  const lastTwo = opts.recentMaxLines.filter(Boolean).slice(-2);
  if (isMaxWordRun(transcript, lastTwo) && opts.timeline.maxAudibleAt(opts.speechStartAt)) {
    return { echo: true, reason: "echo_fragment" };
  }
  return { echo: false };
}

/** After this many echo drops in one call, the tester is told speakers are feeding back */
export const ECHO_NOTICE_AFTER = 2;
