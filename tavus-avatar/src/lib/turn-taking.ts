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

export const PENDING_MAX_AGE_MS = 8000;
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
}

export class TurnController {
  private inFlight = 0;
  private turnSeq = 0;
  private pending: { text: string; at: number } | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private deps: TurnControllerDeps) {}

  get isBusy(): boolean {
    return this.inFlight > 0;
  }

  /** A finished customer utterance from the speech recognizer. */
  onTranscript(text: string): void {
    const transcript = text.trim();
    if (!transcript) return;
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
    const turnId = ++this.turnSeq;
    this.inFlight++;
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
