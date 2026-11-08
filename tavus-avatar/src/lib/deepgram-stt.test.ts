import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { chooseSttEngine, ResultAssembler, DeepgramRecognizer, DEEPGRAM_LISTEN_URL, type RecognizerLike } from "./deepgram-stt";

describe("which speech recognition a call uses", () => {
  it("the URL wins, then the configured default, else the browser's", () => {
    expect(chooseSttEngine("?stt=deepgram", undefined)).toBe("deepgram");
    expect(chooseSttEngine("?stt=webspeech", "deepgram")).toBe("webspeech");
    expect(chooseSttEngine("", "deepgram")).toBe("deepgram");
    expect(chooseSttEngine("?stt=other", undefined)).toBe("webspeech");
    expect(chooseSttEngine("", undefined)).toBe("webspeech");
  });

  it("asks Deepgram for interim results, voice events and a 300 ms endpoint", () => {
    const url = new URL(DEEPGRAM_LISTEN_URL);
    expect(url.searchParams.get("interim_results")).toBe("true");
    expect(url.searchParams.get("vad_events")).toBe("true");
    expect(url.searchParams.get("endpointing")).toBe("300");
  });
});

describe("Deepgram results in the browser recognizer's shape", () => {
  it("replaces the interim, fixes it when final, and starts a new entry after", () => {
    const a = new ResultAssembler();
    expect(a.add("yes I", false)).toEqual({ resultIndex: 0, results: [{ 0: { transcript: "yes I" }, isFinal: false }] });
    expect(a.add("yes I drove it", true)).toEqual({ resultIndex: 0, results: [{ 0: { transcript: "yes I drove it" }, isFinal: true }] });
    const next = a.add("and", false)!;
    expect(next.resultIndex).toBe(1);
    expect(next.results).toHaveLength(2);
    expect(next.results[0].isFinal).toBe(true);
  });

  it("an empty final drops an interim that came to nothing, and emits nothing", () => {
    const a = new ResultAssembler();
    a.add("uh", false);
    expect(a.add("", true)).toBeNull();
    expect(a.add("okay", true)?.resultIndex).toBe(0);
  });
});

// --- fakes for the browser APIs the recognizer uses ---------------------------------------------
class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket | null = null;
  readyState = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(public url: string, public protocols: string[]) {
    FakeSocket.last = this;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  message(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
  send(d: unknown) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
  }
}
class FakeRecorder {
  static isTypeSupported = () => true;
  state = "inactive";
  ondataavailable: ((e: { data: { size: number } }) => void) | null = null;
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
  }
}
class FakeStream {
  constructor(private tracks: unknown[] = [{}]) {}
  getAudioTracks() {
    return this.tracks;
  }
  getTracks() {
    return [];
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function browserRecognizer(): RecognizerLike & { started: number } {
  return { started: 0, start() { this.started++; }, stop() {}, onresult: null, onspeechstart: null, onerror: null, onend: null };
}

describe("DeepgramRecognizer", () => {
  beforeEach(() => {
    FakeSocket.last = null;
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    vi.stubGlobal("MediaStream", FakeStream);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("streams the echo-cancelled mic with a short-lived token and reports results like the browser", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: "tmp-token" }) }));
    const rec = new DeepgramRecognizer({ getStream: () => new FakeStream() as unknown as MediaStream, fallback: () => null, log: () => {} });
    const results: unknown[] = [];
    let speechStarts = 0;
    rec.onresult = (e) => results.push(e);
    rec.onspeechstart = () => speechStarts++;

    rec.start();
    await flush();
    const ws = FakeSocket.last!;
    expect(ws.protocols).toEqual(["bearer", "tmp-token"]);
    ws.open();
    ws.message({ type: "SpeechStarted" });
    ws.message({ type: "Results", is_final: false, channel: { alternatives: [{ transcript: "can we" }] } });
    ws.message({ type: "Results", is_final: true, channel: { alternatives: [{ transcript: "can we start over" }] } });

    expect(speechStarts).toBe(1);
    expect(results).toHaveLength(2);
    expect(results[1]).toEqual({ resultIndex: 0, results: [{ 0: { transcript: "can we start over" }, isFinal: true }] });
    expect(rec.engine).toBe("deepgram");
  });

  it("stop closes the stream politely and ends like the browser recognizer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: "t" }) }));
    const rec = new DeepgramRecognizer({ getStream: () => new FakeStream() as unknown as MediaStream, fallback: () => null, log: () => {} });
    let ended = 0;
    rec.onend = () => ended++;
    rec.start();
    await flush();
    const ws = FakeSocket.last!;
    ws.open();
    rec.stop();
    expect(ws.sent).toContain(JSON.stringify({ type: "CloseStream" }));
    expect(ended).toBe(1);
  });

  it("without a Deepgram key, the browser recognizer takes over with the same handlers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: "DEEPGRAM_API_KEY is not set" }) }));
    const browser = browserRecognizer();
    const rec = new DeepgramRecognizer({ getStream: () => null, fallback: () => browser, log: () => {} });
    const got: unknown[] = [];
    rec.onresult = (e) => got.push(e);
    rec.start();
    await flush();
    expect(browser.started).toBe(1);
    expect(rec.engine).toBe("webspeech");
    browser.onresult?.({ resultIndex: 0, results: [{ 0: { transcript: "hi" }, isFinal: true }] });
    expect(got).toHaveLength(1);
    // Later starts and stops go to the browser recognizer
    rec.start();
    expect(browser.started).toBe(2);
    expect(FakeSocket.last).toBeNull();
  });

  it("a refused connection also falls back to the browser recognizer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: "t" }) }));
    const browser = browserRecognizer();
    const rec = new DeepgramRecognizer({ getStream: () => new FakeStream() as unknown as MediaStream, fallback: () => browser, log: () => {} });
    rec.start();
    await flush();
    FakeSocket.last!.onclose?.({ code: 1008 });
    expect(browser.started).toBe(1);
    expect(rec.engine).toBe("webspeech");
  });
});
