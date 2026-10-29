# Production Implementation Plan: Max DFM (Digital Finance Manager) with HeyGen Live Streaming Architecture

This implementation plan consolidates everything required to build, orchestrate, and deploy **Max DFM** using the **HeyGen Streaming API** (Avatar-Only/Lite mode), combined with your custom sub-second voice pipeline, dynamic beat controller, and a clean side-by-side presentation screen.

---

## Architecture Overview

```
[ Customer Audio ] 
       │
       ▼
[ Semantic VAD & Streaming STT ] ──► [ Redis State Anchor (800-token window) ]
                                            │
                                            ▼
[ Unified LLM Turn Handler ] ◄──────────────┘
  ├─ Evaluates Intent & Tone (Angry, Joking, Rushed, Agreement)
  ├─ Generates 1-Sentence Adaptive Bridge (Banter/Empathy)
  └─ Selects Next Script Beat + UI Slide Trigger
       │
       ▼
[ Custom Chunked TTS Pipeline ] ──► [ HeyGen Streaming Task API (task_type: "repeat") ]
                                            │
                                            ▼
[ Next.js Frontend Layout ] ◄───────────────┘
  ├─ Left Panel: Dynamic Presentation Slides / Pricing Tables
  └─ Right Panel: HeyGen WebRTC Video Stream (<video> ref)

```

---

## Phase 1: Backend State & LLM Orchestration (`beat-controller.ts`)

Replace your separate intent classifier and off-script LLM functions with a single, high-performance turn handler that evaluates the customer's mood (banter, anger, agreement) and appends the appropriate script beat.

### 1.1 The Unified Turn Handler

Create or update `src/lib/beat-controller.ts`:

```typescript
import { MASTER_BEATS, BeatDefinition } from './beats-config';

// 0ms Fast-Path Regex for common agreements (skips LLM overhead)
const FAST_AFFIRMATIVE_REGEX = /^(yes|yeah|yep|yup|sure|okay|ok|alright|go ahead|sounds good|makes sense|i follow|uh huh|mhm|right|correct|true|got it|continue|carry on|let's go|no|nope|not really)[\.\!\?]?$/i;

export interface TurnDecision {
  tone: "ANGRY_DEFENSIVE" | "JOKING_BANTER" | "IMPATIENT_RUSHED" | "NEUTRAL_AGREEING" | "QUESTION" | "EARLY_PRICE_OBJECTION";
  bridge_sentence: string | null;
  advance_beat: boolean;
}

export async function processCustomerTurn(
  userTranscript: string,
  currentBeatId: number,
  vehicleInfo = "2026 Mazda CX-5"
): Promise<{ speechToDeliver: string; nextBeatPointer: number; uiTrigger: string | null }> {
  const cleanTranscript = userTranscript.trim();
  const nextBeatId = Math.min(currentBeatId + 1, 22);

  // 1. 0ms Fast Path for simple confirmations
  if (FAST_AFFIRMATIVE_REGEX.test(cleanTranscript) && currentBeatId >= 0 && currentBeatId < 22) {
    return buildBeatPayload(nextBeatId, null);
  }

  // 2. Adaptive Personality & Intent Prompt
  const systemPrompt = `You are the behavioral brain for Max, a master Digital Finance Manager at a Texas dealership reviewing paperwork for a ${vehicleInfo}.
Current Beat Delivered: Beat ${currentBeatId} ("${MASTER_BEATS[currentBeatId]?.text || ""}")
Next Beat Queued: Beat ${nextBeatId} ("${MASTER_BEATS[nextBeatId]?.text || ""}")

Analyze the customer's reply, mood, and tone. Output STRICT JSON only:
{
  "tone": "ANGRY_DEFENSIVE" | "JOKING_BANTER" | "IMPATIENT_RUSHED" | "NEUTRAL_AGREEING" | "QUESTION" | "EARLY_PRICE_OBJECTION",
  "bridge_sentence": "string or null",
  "advance_beat": true | false
}

DYNAMIC RULES FOR `bridge_sentence`:
1. "ANGRY_DEFENSIVE" (cursing, frustration): Deliver a deeply empathetic, defusing sentence ("I completely get where you're coming from, let's walk through it together.") before advancing. Do not argue.
2. "JOKING_BANTER" (making jokes, sarcastic remarks): Play along with a light, witty one-liner in character ("Fair point, but...") before steering them back to the paperwork.
3. "IMPATIENT_RUSHED" ("Cut to the chase", "Hurry up"): "Understood, let's dive right in."
4. "QUESTION" or off-script query: Answer directly and warmly in under 15 words.
5. "EARLY_PRICE_OBJECTION": "I'm going to pull up the exact breakdown on your screen in just a moment."
6. "NEUTRAL_AGREEING": null.`;

  const rawLLMResponse = await callFastLLM(systemPrompt, cleanTranscript);
  const decision: TurnDecision = JSON.parse(rawLLMResponse);

  const targetBeatId = decision.advance_beat ? nextBeatId : currentBeatId;
  return buildBeatPayload(targetBeatId, decision.bridge_sentence);
}

function buildBeatPayload(startBeatId: number, bridgeSentence: string | null) {
  let pointer = startBeatId;
  const speechParts: string[] = [];
  let uiTrigger: string | null = null;

  if (bridgeSentence) {
    speechParts.push(bridgeSentence.trim());
  }

  while (MASTER_BEATS[pointer]) {
    const beat = MASTER_BEATS[pointer];
    speechParts.push(beat.text);
    if (beat.uiTrigger) uiTrigger = beat.uiTrigger;

    if (beat.type === "WAIT" || pointer >= 22) {
      break;
    }
    pointer++;
  }

  return {
    speechToDeliver: speechParts.join(" "),
    nextBeatPointer: pointer,
    uiTrigger,
  };
}

```

---

## Phase 2: HeyGen Streaming API Integration (`useHeyGenStream.ts`)

Configure the frontend hook to handle WebRTC SDP handshakes and enforce **`task_type: "repeat"`** to prevent HeyGen from running its own internal LLM.

### 2.1 The Streaming Hook

Create `src/hooks/useHeyGenStream.ts`:

```typescript
import { useState, useRef, useCallback } from 'react';

const HEYGEN_API_URL = 'https://api.heygen.com/v1/streaming';

export function useHeyGenStream() {
  const [sessionInfo, setSessionInfo] = useState<{ sessionId: string } | null>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Initialize WebRTC session
  const startSession = useCallback(async (avatarId: string, voiceId: string, apiKey: string) => {
    try {
      const createRes = await fetch(`${HEYGEN_API_URL}.new`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
        body: JSON.stringify({ quality: 'high', avatar_name: avatarId, voice: { voice_id: voiceId } })
      });
      const createData = await createRes.json();
      const sessionId = createData.data.session_id;

      peerConnection.current = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      
      peerConnection.current.ontrack = (event) => {
        if (event.track.kind === 'video' && videoRef.current) {
          videoRef.current.srcObject = event.streams[0];
        }
      };

      const remoteDesc = new RTCSessionDescription({ type: 'offer', sdp: createData.data.sdp.sdp });
      await peerConnection.current.setRemoteDescription(remoteDesc);

      const localDesc = await peerConnection.current.createAnswer();
      await peerConnection.current.setLocalDescription(localDesc);

      await fetch(`${HEYGEN_API_URL}.start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
        body: JSON.stringify({ session_id: sessionId, sdp: localDesc })
      });

      setSessionInfo({ sessionId });
      return sessionId;
    } catch (error) {
      console.error("HeyGen Session Initialization Failed:", error);
    }
  }, []);

  // Send speech using 'repeat' mode (bypasses HeyGen LLM)
  const speakBeat = useCallback(async (text: string, apiKey: string) => {
    if (!sessionInfo?.sessionId) return;
    
    await fetch(`${HEYGEN_API_URL}.task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify({
        session_id: sessionInfo.sessionId,
        text: text,
        task_type: 'repeat' // CRITICAL: Forces HeyGen to speak exact text immediately
      })
    });
  }, [sessionInfo]);

  // Instant Barge-In Interrupt
  const interruptAvatar = useCallback(async (apiKey: string) => {
    if (!sessionInfo?.sessionId) return;
    
    await fetch(`${HEYGEN_API_URL}.interrupt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify({ session_id: sessionInfo.sessionId })
    });
  }, [sessionInfo]);

  return { videoRef, startSession, speakBeat, interruptAvatar, isConnected: !!sessionInfo };
}

```

---

## Phase 3: Split-Screen Presentation UI (`MaxDFMCallRoom.tsx`)

Build a clean split-screen interface where the left panel controls the presentation slide deck (warranty terms, cost breakdowns, pricing tables) and the right panel renders the HeyGen avatar.

### 3.1 Call Room Component

Create `src/components/MaxDFMCallRoom.tsx`:

```tsx
import React, { useState, useEffect } from 'react';
import { useHeyGenStream } from '../hooks/useHeyGenStream';

export default function MaxDFMCallRoom({ apiKey, avatarId, voiceId }: { apiKey: string; avatarId: string; voiceId: string }) {
  const { videoRef, startSession, speakBeat, interruptAvatar, isConnected } = useHeyGenStream();
  const [currentSlide, setCurrentSlide] = useState('welcome_slide');

  useEffect(() => {
    startSession(avatarId, voiceId, apiKey);
  }, [startSession, avatarId, voiceId, apiKey]);

  // Example listener for backend state updates
  const handleAgentTurnResponse = (speechText: string, uiTrigger: string | null) => {
    speakBeat(speechText, apiKey);
    if (uiTrigger) {
      setCurrentSlide(uiTrigger);
    }
  };

  return (
    <div className="flex h-screen w-full bg-gray-100 overflow-hidden">
      
      {/* Left Panel: Presentation Screen (70%) */}
      <div className="w-2/3 h-full flex flex-col justify-center items-center p-10 bg-white shadow-xl z-10">
        {currentSlide === 'welcome_slide' && (
          <div className="text-center">
            <h1 className="text-4xl font-extrabold text-gray-900 mb-4">Welcome to Your New Mazda CX-5</h1>
            <p className="text-lg text-gray-600">Preparing your final delivery and finance paperwork...</p>
          </div>
        )}

        {currentSlide === 'show_content:warranty_terms' && (
          <div className="w-full max-w-xl bg-blue-50 border border-blue-200 p-8 rounded-2xl shadow-sm">
            <h2 className="text-2xl font-bold text-blue-900 mb-4">Manufacturer Warranties</h2>
            <ul className="space-y-3 text-gray-700 text-lg">
              <li>🛡️ <strong>3 Years / 36,000 Miles</strong> - Base Limited Warranty</li>
              <li>⚙️ <strong>5 Years / 60,000 Miles</strong> - Powertrain (Engine & Transmission)</li>
            </ul>
          </div>
        )}

        {currentSlide === 'show_pricing:vsc' && (
          <div className="w-full max-w-xl bg-emerald-50 border border-emerald-200 p-8 rounded-2xl shadow-sm text-center">
            <h2 className="text-2xl font-bold text-emerald-900 mb-2">Vehicle Service Contract</h2>
            <p className="text-3xl font-extrabold text-emerald-700 my-4">7 Years / 100,000 Miles</p>
            <p className="text-gray-600">Bumper-to-Bumper Coverage • $0 Deductible</p>
          </div>
        )}
      </div>

      {/* Right Panel: HeyGen Avatar Stream (30% + Nameplate) */}
      <div className="w-1/3 h-full bg-black relative flex items-center justify-center border-l-4 border-gray-900">
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          className="w-full h-full object-cover" 
        />
        
        {/* Connection Status Badge */}
        <div className="absolute top-4 right-4 px-3 py-1 bg-black/60 backdrop-blur-md rounded-full text-xs text-white">
          {isConnected ? "🟢 Connected" : "connecting..."}
        </div>

        {/* Max DFM Nameplate Overlay */}
        <div className="absolute bottom-6 left-6 bg-black/70 backdrop-blur-md px-4 py-2.5 rounded-lg text-white">
          <p className="font-bold text-sm tracking-wide">Max Chittala</p>
          <p className="text-xs text-gray-400">Digital Finance Manager</p>
        </div>
      </div>

    </div>
  );
}

```

---

## Phase 4: Pre-Demo Validation Checklist

Before presenting this to your client, run through these exact checks:

1. **TTS Phonetics Test:** Verify that words like *ware and tear*, *Bumper-to-Bumper*, and *powertrain* are spelled correctly in `MASTER_BEATS` so HeyGen's lip-sync aligns without stuttering.
2. **Task Type Verification:** Inspect network logs to ensure `task_type: "repeat"` is explicitly passed in your HeyGen POST request body, cutting response delay down to sub-second speeds.
3. **Interrupt Verification:** Test speaking over Max mid-sentence; verify that calling `interruptAvatar` instantly silences the stream.