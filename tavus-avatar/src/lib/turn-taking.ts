/**
 * Client-side turn taking for the live avatar call, kept free of React and browser APIs so it can be
 * unit-tested with fake timers. liveavatar-demo.tsx wires it to the speech recognizer, LiveKit and
 * /api/chat/grok.
 *
 * Rule: customer speech is never silently dropped. A transcript that cannot be sent right now
 * (Max is speaking, or a request is already in flight) is parked in a one-slot pending queue and
 * replayed when Max is idle, unless it is stale, an echo of Max, or a lone filler/backchannel.
 * Every drop and replay is logged as one JSON line.
 */

export interface TurnLogEvent {
  ts: string;
  event: string;
  reason?: string;
  transcript?: string;
  ageMs?: number;
  [key: string]: unknown;
}

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// Murmurs that acknowledge without answering anything
const BACKCHANNEL = new Set([
  "yes", "yeah", "yep", "yup", "ok", "okay", "sure", "right", "mhm", "mm hm", "mm hmm", "mmhmm", "uh huh",
  "uh", "um", "hmm", "hm", "ah", "er", "i see", "got it", "gotcha",
]);

/** A lone filler or backchannel ("yeah", "mm-hm", "uh"). Not worth replaying after the fact. */
export function isLoneFiller(transcript: string): boolean {
  const n = norm(transcript);
  if (!n) return true;
  if (BACKCHANNEL.has(n)) return true;
  return n.split(" ").every((w) => BACKCHANNEL.has(w));
}

// -----------------------------------------------------------------------------
// Avatar commands: one serialized queue, so an interrupt can never be published after a newer
// speak_text, and a speak issued before a barge-in is skipped instead of talking over the customer.
// -----------------------------------------------------------------------------
export type AvatarCommand =
  | { type: "speak_text"; text: string }
  | { type: "interrupt" }
  | { type: "start_listening" }
  | { type: "stop_listening" };

export class AvatarCommandQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private gen = 0;

  constructor(
    private publish: (cmd: AvatarCommand) => Promise<void>,
    private log: (event: TurnLogEvent) => void = () => {}
  ) {}

  get generation(): number {
    return this.gen;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task);
    this.tail = run.catch(() => {}); // one failed command must not jam the queue
    return run;
  }

  /** Resolves true if published, false if a newer interrupt made it stale. */
  speak(text: string): Promise<boolean> {
    const issuedGen = this.gen;
    const stale = () => {
      this.log({ ts: new Date().toISOString(), event: "speak_skipped", reason: "superseded_by_interrupt", transcript: text });
      return false;
    };
    return this.enqueue(async () => {
      if (issuedGen !== this.gen) return stale();
      try {
        await this.publish({ type: "stop_listening" });
      } catch {
        // posture only; never blocks speech
      }
      if (issuedGen !== this.gen) return stale();
      await this.publish({ type: "speak_text", text });
      return true;
    });
  }

  /** Bumps the generation immediately (before anything queued runs), then interrupts. */
  interrupt(): Promise<void> {
    this.gen++;
    return this.enqueue(async () => {
      await this.publish({ type: "interrupt" });
      await this.publish({ type: "start_listening" });
    });
  }

  startListening(): Promise<void> {
    return this.enqueue(() => this.publish({ type: "start_listening" }));
  }
}

// -----------------------------------------------------------------------------
// Speaking state: the single source of truth for "is Max talking". Every way out (stop event,
// interrupt, speak-start timeout, watchdog) goes through reset(), which clears all timers together.
// -----------------------------------------------------------------------------
export const SPEAK_START_TIMEOUT_MS = 3000;
const WORDS_PER_SECOND = 2.8;

export function expectedSpeechMs(text: string): number {
  return Math.max(1200, (text.trim().split(/\s+/).length / WORDS_PER_SECOND) * 1000);
}

export class SpeakingTracker {
  speaking = false;
  /** epoch ms of the current line's first audio (0 until HeyGen confirms) */
  startedAt = 0;
  stoppedAt = 0;
  private expectedMs = 0;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private onChange: (speaking: boolean, reason: string) => void,
    private log: (event: TurnLogEvent) => void = () => {}
  ) {}

  /** speak_text is about to be published. If HeyGen never confirms, reset after SPEAK_START_TIMEOUT_MS. */
  beginSpeak(text: string): void {
    this.clearTimers();
    this.expectedMs = expectedSpeechMs(text);
    this.startedAt = 0;
    this.set(true, "speak_issued");
    this.startTimer = setTimeout(() => {
      if (this.speaking && !this.startedAt) this.reset("speak_start_timeout");
    }, SPEAK_START_TIMEOUT_MS);
  }

  /** HeyGen start_talking / speak_started. The watchdog runs from real first audio. */
  onStarted(): void {
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = null;
    this.startedAt = Date.now();
    if (!this.expectedMs) this.expectedMs = 8000;
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => this.reset("watchdog"), this.expectedMs + 3000);
    if (!this.speaking) this.set(true, "speak_started");
  }

  onStopped(): void {
    this.reset("stop_event");
  }

  reset(reason: string): void {
    this.clearTimers();
    const was = this.speaking;
    this.stoppedAt = Date.now();
    if (reason !== "stop_event" && reason !== "interrupted") {
      this.log({ ts: new Date().toISOString(), event: "speaking_flag_reset", reason, wasSpeaking: was });
    }
    this.set(false, reason);
  }

  msIntoLine(): number {
    return this.speaking && this.startedAt ? Date.now() - this.startedAt : 0;
  }

  /** How much of the current line has been heard, 0..1 (0 if audio never started). */
  spokenFraction(): number {
    if (!this.startedAt || !this.expectedMs) return 0;
    const end = this.speaking ? Date.now() : this.stoppedAt;
    return Math.min(1, Math.max(0, (end - this.startedAt) / this.expectedMs));
  }

  private set(value: boolean, reason: string): void {
    this.speaking = value;
    this.onChange(value, reason);
  }

  private clearTimers(): void {
    if (this.startTimer) clearTimeout(this.startTimer);
    if (this.watchdog) clearTimeout(this.watchdog);
    this.startTimer = null;
    this.watchdog = null;
  }
}

/** Max's voice: queue + speaking state, so an interrupt always leaves the flag false. */
export class AvatarVoice {
  readonly queue: AvatarCommandQueue;
  readonly tracker: SpeakingTracker;

  constructor(
    publish: (cmd: AvatarCommand) => Promise<void>,
    onSpeakingChange: (speaking: boolean, reason: string) => void,
    private log: (event: TurnLogEvent) => void = () => {}
  ) {
    this.queue = new AvatarCommandQueue(publish, log);
    this.tracker = new SpeakingTracker(onSpeakingChange, log);
  }

  async speak(text: string): Promise<boolean> {
    this.tracker.beginSpeak(text);
    const published = await this.queue.speak(text).catch((err) => {
      this.log({ ts: new Date().toISOString(), event: "speak_failed", reason: String(err), transcript: text });
      return false;
    });
    if (!published && this.tracker.speaking && !this.tracker.startedAt) this.tracker.reset("speak_not_published");
    return published;
  }

  /** Never leaves the speaking flag stuck: reset happens in finally, even if publishing throws. */
  async interrupt(): Promise<void> {
    try {
      await this.queue.interrupt();
    } catch (err) {
      this.log({ ts: new Date().toISOString(), event: "interrupt_failed", reason: String(err) });
    } finally {
      this.tracker.reset("interrupted");
    }
  }
}

/** "Are you there?", "say something", "what was the question": the customer thinks the line is dead. */
export function isPresenceCheck(transcript: string): boolean {
  const n = norm(transcript);
  return (
    /^(hello|hey|hi)( max| there)?$/.test(n) ||
    /\b(are you there|you still there|anybody there|anyone there|can you hear me|say something)\b/.test(n) ||
    /\bwhat (was|s|is) the question\b/.test(n) ||
    /\bwhy (aren t|arent|are not) you (asking|speaking|talking|saying|responding|answering)\b/.test(n)
  );
}

export type RepromptKind = "resume" | "still_with_me" | "clarify";

// No audio this long after the customer spoke (and nothing in flight): make Max speak
export const DEAD_MAN_MS = 4000;
// Customer silence after Max finishes a wait beat before prompting, and the most prompts in a row
export const SILENCE_PROMPT_MS = 7000;
export const MAX_SILENCE_PROMPTS = 3;

// -----------------------------------------------------------------------------
// Barge-in: should this customer speech cut Max off mid-line?
// Live call 1ee5181b: a "yeah" right as Max began a line cut him after 0.3 s, so his question was
// never heard. Backchannels never interrupt; in the first 1.5 s only a stop word does.
// -----------------------------------------------------------------------------
export const BARGE_IN_CUTOFF_WORDS = [
    "wait",
    "stop",
    "no",
    "hold on",
    "sorry",
    "what",
    "hang on",
    "one second",
    "let me",
    "let me tell you",
    "let me speak",
    "let me explain",
    "let me finish",
    "let me complete",
    "listen",
    "hear me out",
    "hear me",
    "actually",
    "excuse me",
    "hold up",
];

// No barge-in this early in a line unless a stop word is said
export const BARGE_IN_GRACE_MS = 1500;
const GRACE_STOP_WORDS = /\b(stop|wait|hold on|excuse me|who is this|who s this)\b/;
const BARGE_IN_BACKCHANNEL = new Set([
  "yes", "yeah", "yep", "ok", "okay", "sure", "mm hm", "mm hmm", "mhm", "uh huh", "uhhuh", "right",
  "uh", "um", "hmm", "hm", "i see", "got it",
]);

function isBackchannelOnly(n: string): boolean {
  if (BARGE_IN_BACKCHANNEL.has(n)) return true;
  // "yeah yeah", "okay got it": every chunk is a backchannel
  const chunks = n.replace(/\b(mm hm+|uh huh|i see|got it)\b/g, "_").split(" ");
  return chunks.every((w) => w === "_" || BARGE_IN_BACKCHANNEL.has(w));
}

// Stop phrases cut Max at any length after the grace period. Nothing else short does: live call
// ba0dad23 cut him on "brother", "are you", "who are" (the old 1-2 word cut-off rules).
const STOP_PHRASES = /\b(stop|wait|hold on|hang on|excuse me|listen|hear me out|let me (speak|finish|explain))\b/;
// After the grace period, anything that is not a stop phrase needs this many words to cut Max off
export const BARGE_IN_MIN_WORDS = 4;

export function bargeInDecision(transcript: string, msIntoLine: number): { interrupt: boolean; reason: string } {
  const n = norm(transcript);
  if (!n) return { interrupt: false, reason: "empty" };
  if (isBackchannelOnly(n)) return { interrupt: false, reason: "backchannel" };
  if (msIntoLine < BARGE_IN_GRACE_MS) {
    return GRACE_STOP_WORDS.test(n) ? { interrupt: true, reason: "stop_word_in_grace" } : { interrupt: false, reason: "grace_period" };
  }
  if (STOP_PHRASES.test(n)) return { interrupt: true, reason: "stop_phrase" };
  return n.split(" ").length >= BARGE_IN_MIN_WORDS
    ? { interrupt: true, reason: "substantive_speech" }
    : { interrupt: false, reason: "too_short" };
}

// -----------------------------------------------------------------------------
// Interim transcript buffer: the Web Speech recognizer keeps every result of the session. Only results
// from the current Max line / speech segment count, and interim text that has not changed for 2 s is
// stale (live call: "audi you are saying" cut Max 39 s after the customer said it).
// -----------------------------------------------------------------------------
export const INTERIM_STALE_MS = 2000;
export interface RecognizerResult {
  transcript: string;
  isFinal: boolean;
}

export class InterimBuffer {
  private base = 0;
  private length = 0;
  private lastChange = new Map<number, { text: string; at: number }>();

  /** Start of a Max line, or a new speech start: earlier results no longer count. */
  reset(): void {
    this.base = this.length;
    this.lastChange.clear();
  }

  /** Feed a recognizer result event; returns only fresh interim text and the finals since the last reset. */
  update(results: RecognizerResult[], resultIndex: number): { interim: string; final: string } {
    this.length = results.length;
    const now = Date.now();
    let interim = "";
    let final = "";
    for (let i = Math.max(resultIndex, this.base); i < results.length; i++) {
      const r = results[i];
      if (r.isFinal) {
        final += r.transcript;
        continue;
      }
      const prev = this.lastChange.get(i);
      if (!prev || prev.text !== r.transcript) this.lastChange.set(i, { text: r.transcript, at: now });
      if (now - (this.lastChange.get(i)?.at ?? now) <= INTERIM_STALE_MS) interim += r.transcript;
    }
    return { interim, final };
  }
}

// Helper to determine if incoming user speech should trigger instant barge-in cut-off
export function shouldCutMaxOff(spoken: string): boolean {
  const norm = spoken.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
  const words = norm.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;

  // 1. Explicit passive backchannel murmurs do NOT cut Max off
  const PASSIVE_BACKCHANNELS = new Set([
    "mhm",
    "uh huh",
    "uh-huh",
    "uhhuh",
    "mm",
    "hmm",
    "yeah",
    "yes",
    "okay",
    "ok",
    "right",
    "sure",
    "yep",
    "gotcha",
    "uh",
    "um",
    "ah",
  ]);

  if (PASSIVE_BACKCHANNELS.has(norm)) {
    return false;
  }
  // Single-word passive acknowledgment
  if (words.length === 1 && PASSIVE_BACKCHANNELS.has(words[0])) {
    return false;
  }
  // Repetitive backchannel mutterings (e.g. "yeah yeah", "uh huh")
  if (words.every((w) => PASSIVE_BACKCHANNELS.has(w))) {
    return false;
  }

  // 2. Explicit cutoff words/phrases cut Max off immediately
  for (const cutoff of BARGE_IN_CUTOFF_WORDS) {
    if (
      norm === cutoff ||
      norm.startsWith(`${cutoff} `) ||
      norm.endsWith(` ${cutoff}`) ||
      norm.includes(` ${cutoff} `)
    ) {
      return true;
    }
  }

  // 3. User questions starting with interrogatives or intent openers cut Max off
  if (
    norm.startsWith("who ") ||
    norm.startsWith("what ") ||
    norm.startsWith("why ") ||
    norm.startsWith("how ") ||
    norm.startsWith("when ") ||
    norm.startsWith("where ") ||
    norm.startsWith("which ") ||
    norm.startsWith("can i ") ||
    norm.startsWith("can you ") ||
    norm.startsWith("could you ") ||
    norm.startsWith("could i ") ||
    norm.startsWith("is that ") ||
    norm.startsWith("is it ") ||
    norm.startsWith("is this ") ||
    norm.startsWith("does it ") ||
    norm.startsWith("does that ") ||
    norm.startsWith("do you ") ||
    norm.startsWith("will it ") ||
    norm.startsWith("would it ") ||
    norm.startsWith("tell me ") ||
    norm.startsWith("i have ") ||
    norm.startsWith("i want ") ||
    norm.startsWith("i need ") ||
    norm.startsWith("excuse me")
  ) {
    return true;
  }

  // 4. Any substantive speech of 2 or more words that is not a pure backchannel cuts Max off immediately!
  if (words.length >= 2) {
    return true;
  }

  // 5. Single words that are NOT passive backchannels (e.g. "wait", "stop", "no", "listen", "actually", "hey", "hello", "max")
  if (words.length === 1 && !PASSIVE_BACKCHANNELS.has(words[0])) {
    return true;
  }

  return false;
}

export const PENDING_MAX_AGE_MS = 8000;
// One utterance delivered twice (lowercase partial, then punctuated final) is dropped the second time
export const DUPLICATE_WINDOW_MS = 3000;
const tokenSet = (t: string) => new Set(norm(t).split(" ").filter(Boolean));
export function tokenOverlap(a: string, b: string): number {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / Math.max(A.size, B.size);
}
// Transcripts this soon after Max stops are usually the tail of his own audio
export const POST_SPEECH_GUARD_MS = 600;
const STOP_WORDS = ["stop", "wait", "hold on", "excuse me", "hang on", "hold up", "pause"];

export interface TurnControllerDeps {
  /** Run one customer turn: request, handle the response, start Max speaking. Resolves when the request is done. */
  runTurn(transcript: string, meta: { turnId: number; bypass: boolean }): Promise<void>;
  isAvatarSpeaking(): boolean;
  /** epoch ms when Max last stopped speaking (0 if never) */
  avatarStoppedAt(): number;
  isEcho(transcript: string): boolean;
  log(event: TurnLogEvent): void;
  /** Barge-in for a presence check while the speaking flag is set (possibly stuck). */
  interrupt?(): Promise<void>;
  /** Make Max say something without a customer turn (dead-man switch, silence watchdog). */
  reprompt?(kind: RepromptKind): Promise<void>;
}

export class TurnController {
  private inFlight = 0;
  private turnSeq = 0;
  private pending: { text: string; at: number } | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private deadMan: ReturnType<typeof setTimeout> | null = null;
  private heardAudioSinceTurn = false;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private silencePrompts = 0;
  private lastSent: { text: string; at: number } | null = null;

  constructor(private deps: TurnControllerDeps) {}

  get isBusy(): boolean {
    return this.inFlight > 0;
  }

  /** False once a newer turn has been dispatched: that response is stale and must not be spoken. */
  isLatestTurn(turnId: number): boolean {
    return turnId === this.turnSeq;
  }

  /** A finished customer utterance from the speech recognizer. */
  onTranscript(text: string): void {
    const transcript = text.trim();
    if (!transcript) return;
    this.onCustomerActivity();
    const recent = this.lastSent;
    if (recent && Date.now() - recent.at < DUPLICATE_WINDOW_MS && tokenOverlap(recent.text, transcript) >= 0.8) {
      this.deps.log({ ts: new Date().toISOString(), event: "transcript_dropped", reason: "duplicate_of_recent_turn", transcript, ageMs: Date.now() - recent.at });
      return;
    }
    if (isPresenceCheck(transcript)) return this.presenceCheck(transcript);
    const blocked = this.blockedReason(transcript);
    if (blocked) {
      this.park(transcript, blocked);
      return;
    }
    void this.dispatch(transcript, false);
  }

  /** Call whenever Max stops speaking or anything else may have made the line idle. */
  notifyIdle(): void {
    this.scheduleFlush();
  }

  /** Any customer speech (interim results too): the line is not silent. */
  onCustomerActivity(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
    this.silencePrompts = 0;
  }

  /** HeyGen confirmed first audio of a line. */
  onAvatarAudio(): void {
    this.heardAudioSinceTurn = true;
    if (this.deadMan) clearTimeout(this.deadMan);
    this.deadMan = null;
  }

  /** Max finished a line naturally. At a wait beat, start the silence watchdog. */
  onAvatarFinished(beatType: string): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
    if (beatType !== "wait" || this.silencePrompts >= MAX_SILENCE_PROMPTS || !this.deps.reprompt) return;
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;
      if (this.inFlight > 0 || this.deps.isAvatarSpeaking()) return;
      this.silencePrompts++;
      const kind: RepromptKind = this.silencePrompts === 1 ? "still_with_me" : "clarify";
      this.deps.log({ ts: new Date().toISOString(), event: "silence_prompt", reason: kind, count: this.silencePrompts });
      void this.deps.reprompt?.(kind);
    }, SILENCE_PROMPT_MS);
  }

  /**
   * The customer thinks the line is dead. Bypass the speaking gate and the in-flight lock: if a reply
   * is already on its way it answers them (and the dead-man switch covers it never arriving);
   * otherwise interrupt whatever the flag says Max is doing and send it now.
   */
  private presenceCheck(transcript: string): void {
    const base = { ts: new Date().toISOString(), transcript };
    if (this.inFlight > 0) {
      this.deps.log({ ...base, event: "presence_check", reason: "reply_in_flight" });
      return;
    }
    this.pending = null;
    if (this.deps.isAvatarSpeaking()) {
      this.deps.log({ ...base, event: "presence_check", reason: "interrupting_speaking_flag" });
      void this.deps.interrupt?.();
    } else {
      this.deps.log({ ...base, event: "presence_check", reason: "line_idle" });
    }
    void this.dispatch(transcript, true);
  }

  /** Armed when a customer turn is sent: if no audio follows within DEAD_MAN_MS, force Max to speak. */
  private armDeadMan(): void {
    if (!this.deps.reprompt) return;
    this.heardAudioSinceTurn = false;
    if (this.deadMan) clearTimeout(this.deadMan);
    const check = () => {
      this.deadMan = null;
      if (this.heardAudioSinceTurn) return;
      if (this.inFlight > 0) {
        this.deadMan = setTimeout(check, 500); // wait for the request, then re-check
        return;
      }
      this.deps.log({ ts: new Date().toISOString(), event: "dead_man_switch", reason: "no_audio_after_customer_turn" });
      void this.deps.reprompt?.("resume");
    };
    this.deadMan = setTimeout(check, DEAD_MAN_MS);
  }

  private blockedReason(transcript: string): string | null {
    if (this.inFlight > 0) return "request_in_flight";
    const n = transcript.toLowerCase();
    if (STOP_WORDS.some((w) => n.includes(w))) return null;
    if (this.deps.isAvatarSpeaking()) return "avatar_speaking";
    if (Date.now() - this.deps.avatarStoppedAt() < POST_SPEECH_GUARD_MS) return "within_600ms_post_stop";
    return null;
  }

  private park(transcript: string, reason: string): void {
    const replaced = this.pending?.text;
    this.pending = { text: transcript, at: Date.now() };
    this.deps.log({ ts: new Date().toISOString(), event: "transcript_parked", reason, transcript, replaced });
    this.scheduleFlush();
  }

  protected async dispatch(transcript: string, bypass: boolean): Promise<void> {
    this.lastSent = { text: transcript, at: Date.now() };
    const turnId = ++this.turnSeq;
    this.inFlight++;
    this.armDeadMan();
    try {
      await this.deps.runTurn(transcript, { turnId, bypass });
    } finally {
      this.inFlight--;
      this.scheduleFlush();
    }
  }

  private scheduleFlush(): void {
    if (!this.pending) return;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.inFlight > 0 || this.deps.isAvatarSpeaking()) return; // re-checked on the next notifyIdle / turn end
    const wait = Math.max(0, this.deps.avatarStoppedAt() + POST_SPEECH_GUARD_MS - Date.now());
    this.flushTimer = setTimeout(() => this.flush(), wait);
  }

  private flush(): void {
    this.flushTimer = null;
    const p = this.pending;
    if (!p || this.inFlight > 0 || this.deps.isAvatarSpeaking()) return;
    this.pending = null;
    const ageMs = Date.now() - p.at;
    const base = { ts: new Date().toISOString(), transcript: p.text, ageMs };
    if (ageMs > PENDING_MAX_AGE_MS) return this.deps.log({ ...base, event: "pending_discarded", reason: "stale" });
    if (this.deps.isEcho(p.text)) return this.deps.log({ ...base, event: "pending_discarded", reason: "echo" });
    if (isLoneFiller(p.text)) return this.deps.log({ ...base, event: "pending_discarded", reason: "lone_filler" });
    this.deps.log({ ...base, event: "pending_replayed" });
    void this.dispatch(p.text, false);
  }
}
