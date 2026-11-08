/**
 * Server speech-to-text for live calls (follow-up 10 E5, docs/ECHO-STT-DESIGN.md).
 *
 * Streams the echo-cancelled microphone (the getUserMedia track the app already opens) to Deepgram
 * over a WebSocket, using a short-lived token from /api/stt/token, so Max's voice from the speakers
 * is removed before recognition and finals arrive in a few hundred ms instead of 0.6-5 s.
 *
 * DeepgramRecognizer has the same surface as the browser's SpeechRecognition (start, stop,
 * onresult, onspeechstart, onerror, onend; results shaped like SpeechRecognitionEvent), so the
 * call screen's turn-taking, barge-in and echo logic run unchanged. If Deepgram is not set up or
 * fails, it hands over to the browser recognizer for the rest of the call.
 *
 * Client-safe: no server imports.
 */

export type SttEngine = "deepgram" | "webspeech";

/** The parts of the browser's SpeechRecognition the call screen uses */
export interface RecognizerLike {
  start(): void;
  stop(): void;
  onresult: ((event: RecognizerEvent) => void) | null;
  onspeechstart: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

export interface RecognizerEvent {
  resultIndex: number;
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
}

/** Which engine a call uses: ?stt=deepgram|webspeech in the URL, else NEXT_PUBLIC_STT_ENGINE, else the browser's. */
export function chooseSttEngine(search: string, configured: string | undefined): SttEngine {
  const fromUrl = new URLSearchParams(search).get("stt");
  if (fromUrl === "deepgram" || fromUrl === "webspeech") return fromUrl;
  return configured === "deepgram" ? "deepgram" : "webspeech";
}

export const DEEPGRAM_LISTEN_URL =
  "wss://api.deepgram.com/v1/listen?" +
  new URLSearchParams({
    model: "nova-3",
    language: "en-US",
    smart_format: "true",
    punctuate: "true",
    interim_results: "true",
    // A final as soon as there is 300 ms of silence; the call screen's own timers decide the turn end
    endpointing: "300",
    utterance_end_ms: "1000",
    vad_events: "true",
  }).toString();

const CHUNK_MS = 250;
const KEEPALIVE_MS = 8000;

/**
 * Turns Deepgram's stream of interim and final results into the browser recognizer's shape: one
 * growing list per session where the last entry is replaced while interim and fixed once final.
 */
export class ResultAssembler {
  private results: Array<{ 0: { transcript: string }; isFinal: boolean }> = [];

  reset(): void {
    this.results = [];
  }

  /** Feeds one Deepgram "Results" message; returns the event to emit, or null when there is nothing to say. */
  add(transcript: string, isFinal: boolean): RecognizerEvent | null {
    const last = this.results[this.results.length - 1];
    const lastIsInterim = last !== undefined && !last.isFinal;
    const text = transcript.trim();
    if (!text) {
      // An empty final closes an interim that came to nothing
      if (isFinal && lastIsInterim) this.results.pop();
      return null;
    }
    const entry = { 0: { transcript: text }, isFinal };
    if (lastIsInterim) this.results[this.results.length - 1] = entry;
    else this.results.push(entry);
    return { resultIndex: this.results.length - 1, results: [...this.results] };
  }
}

type Deps = {
  /** The echo-cancelled microphone stream, if the app already has one */
  getStream: () => MediaStream | null;
  /** The browser recognizer to hand over to if Deepgram is unavailable */
  fallback: () => RecognizerLike | null;
  log: (message: string, detail?: unknown) => void;
};

export class DeepgramRecognizer implements RecognizerLike {
  onresult: RecognizerLike["onresult"] = null;
  onspeechstart: RecognizerLike["onspeechstart"] = null;
  onerror: RecognizerLike["onerror"] = null;
  onend: RecognizerLike["onend"] = null;

  /** Which engine is actually running (changes to "webspeech" after a fallback) */
  engine: SttEngine = "deepgram";

  private ws: WebSocket | null = null;
  private recorder: MediaRecorder | null = null;
  private ownStream: MediaStream | null = null;
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private delegate: RecognizerLike | null = null;
  private readonly assembler = new ResultAssembler();

  constructor(private readonly deps: Deps) {}

  start(): void {
    if (this.delegate) return this.delegate.start();
    if (this.running) return;
    this.running = true;
    this.assembler.reset();
    void this.connect();
  }

  stop(): void {
    if (this.delegate) return this.delegate.stop();
    this.running = false;
    this.teardown(true);
  }

  private async connect(): Promise<void> {
    let token: string;
    try {
      const res = await fetch("/api/stt/token", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!res.ok || !data.token) throw new Error(data.error || `token request answered ${res.status}`);
      token = data.token;
    } catch (err) {
      return this.fallBack(`no Deepgram token (${err instanceof Error ? err.message : String(err)})`);
    }
    if (!this.running) return;

    let audio: MediaStream;
    try {
      const shared = this.deps.getStream()?.getAudioTracks() ?? [];
      if (shared.length) audio = new MediaStream(shared);
      else {
        this.ownStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        audio = this.ownStream;
      }
    } catch (err) {
      return this.fallBack(`no microphone for Deepgram (${err instanceof Error ? err.message : String(err)})`);
    }

    const ws = new WebSocket(DEEPGRAM_LISTEN_URL, ["bearer", token]);
    this.ws = ws;
    let opened = false;

    ws.onopen = () => {
      opened = true;
      this.deps.log("deepgram connected");
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
      const recorder = new MediaRecorder(audio, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data);
      };
      recorder.start(CHUNK_MS);
      this.recorder = recorder;
      this.keepAlive = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "KeepAlive" }));
      }, KEEPALIVE_MS);
    };

    ws.onmessage = (msg) => {
      let data: { type?: string; is_final?: boolean; channel?: { alternatives?: Array<{ transcript?: string }> } };
      try {
        data = JSON.parse(String(msg.data));
      } catch {
        return;
      }
      if (data.type === "SpeechStarted") this.onspeechstart?.();
      else if (data.type === "Results") {
        const event = this.assembler.add(data.channel?.alternatives?.[0]?.transcript ?? "", Boolean(data.is_final));
        if (event) this.onresult?.(event);
      }
    };

    ws.onerror = () => this.deps.log("deepgram socket error");

    ws.onclose = (e) => {
      const wasRunning = this.running;
      this.teardown(false);
      if (!opened && wasRunning) return this.fallBack(`Deepgram refused the connection (code ${e.code})`);
      this.running = false;
      // Same as the browser recognizer ending: the call screen restarts it if the call is still live
      this.onend?.();
    };
  }

  /** Deepgram unavailable: run the browser recognizer for the rest of the call, with the same handlers. */
  private fallBack(reason: string): void {
    this.teardown(false);
    this.running = false;
    const fallback = this.deps.fallback();
    this.deps.log(`speech recognition falling back to the browser: ${reason}`);
    if (!fallback) {
      this.onerror?.({ error: "service-not-allowed" });
      return;
    }
    fallback.onresult = (e) => this.onresult?.(e);
    fallback.onspeechstart = () => this.onspeechstart?.();
    fallback.onerror = (e) => this.onerror?.(e);
    fallback.onend = () => this.onend?.();
    this.delegate = fallback;
    this.engine = "webspeech";
    try {
      fallback.start();
    } catch {
      // already started
    }
  }

  private teardown(graceful: boolean): void {
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = null;
    try {
      if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    } catch {}
    this.recorder = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.onmessage = null;
      try {
        if (graceful && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "CloseStream" }));
        ws.close();
      } catch {}
      // A deliberate stop still ends like the browser recognizer does
      if (graceful) this.onend?.();
    }
    this.ownStream?.getTracks().forEach((t) => t.stop());
    this.ownStream = null;
  }
}
