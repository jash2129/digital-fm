# Design note: replacing Chrome Web Speech with server STT (follow-up 10 E5)

Status: **built** (`src/lib/deepgram-stt.ts`, `src/app/api/stt/token/route.ts`), behind the
`?stt=` / `NEXT_PUBLIC_STT_ENGINE` switch with automatic fallback to the browser's recognition.
Setup: "Speech recognition" in `DEPLOY-VERCEL.md`. The design below is what was built, except
that end-of-speech still uses the call screen's own timers (Deepgram's `UtteranceEnd` is not used yet).

## Problem

Max's voice from laptop speakers is recognised as the customer (live call d4711cfb). The browser
already removes that echo from our own microphone stream: `getUserMedia` is opened with
`echoCancellation: true` in `liveavatar-demo.tsx`. But Chrome Web Speech (`webkitSpeechRecognition`)
opens its **own** microphone capture, so the echo-cancelled stream never reaches it. Today that clean
stream only feeds the camera preview and the call recording.

The text filters in `src/lib/echo-guard.ts` (E1-E3) catch most echoes after the fact. They cannot
catch an echo that is mixed with real speech, and they need Max's exact words to compare against.

## Proposal

Send the echo-cancelled microphone track to a streaming speech-to-text service and stop using Web
Speech.

1. **Audio:** reuse the existing `getUserMedia` audio track (echo cancellation, noise suppression
   and auto gain already on). Encode it with `MediaRecorder` (`audio/webm;codecs=opus`, 250 ms
   chunks), the same encoder the call recording already uses.
2. **Transport:** the browser opens a WebSocket **directly** to the STT provider, using a short-lived
   token from a new route, `POST /api/stt/token`. Audio never passes through our server: the Render
   free instance has little CPU, and Next.js route handlers do not hold long WebSocket connections
   well.
3. **Provider:** Deepgram streaming (Nova model) is the first candidate. It returns interim and final
   results, a `SpeechStarted` voice event and an `UtteranceEnd` event, and supports short-lived
   tokens. OpenAI's realtime transcription is the alternative. Check current pricing and free
   credit before choosing: both bill per audio minute.
4. **Wiring into what exists (no change to the turn logic):**
   - provider interim/final results → the same `RecognizerResult { transcript, isFinal }` that
     `InterimBuffer` takes today;
   - `SpeechStarted` → `UtteranceClock.speechStarted()`, a real speech start instead of the first
     result's arrival time;
   - `UtteranceEnd` → the end-of-speech signal, replacing the silence timers;
   - `bargeInDecision`, `TurnController` and the echo guard stay as they are. The echo guard becomes
     a second line of defence.
5. **Rollout:** a switch (`NEXT_PUBLIC_STT=webspeech|server`, default `webspeech`), tested on
   simulated and live calls side by side. If the WebSocket fails, fall back to Web Speech for the
   rest of the call and log it.

## Benefits beyond echo

- Works in Safari and Firefox (Web Speech is Chrome-only today).
- Real speech-start timestamps for the latency table in the Inspector.
- A known, testable recogniser instead of Chrome's, which changes without notice.

## Risks and open questions

- **Cost:** per-minute STT billing on every call, which matters while funds are tight.
- **Privacy:** customer audio goes to a third party. The disclosure already says the call is
  recorded, but legal sign-off should cover a transcription vendor too.
- **Latency:** must beat Web Speech's endpointing in practice. Measure it with the Inspector's
  stage columns before switching the default.
- **Key safety:** the browser only ever sees short-lived tokens, never the API key.

## Effort

About 1-2 days to build behind the switch, plus a round of live test calls on laptop speakers and on
headphones before making it the default.
