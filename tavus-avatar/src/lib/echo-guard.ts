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
 * (1-3 words) are never caught here.
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
