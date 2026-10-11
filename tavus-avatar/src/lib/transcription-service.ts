import { saveHeygenTranscript, getHeygenTranscript } from "./heygen-logger";

export interface DiarizedTurn {
  id: number;
  role: "assistant" | "user";
  speaker: string;
  time: string;
  text: string;
  timestamp?: string;
}

export async function transcribeAudioBuffer(
  audioBuffer: Buffer,
  sessionId?: string
): Promise<{ text: string; segments: Array<{ id: number; start: number; end: number; text: string }> }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY in environment");
  }

  const audioBlob = new Blob([new Uint8Array(audioBuffer)], { type: "audio/webm" });
  const formData = new FormData();
  formData.append("file", audioBlob, `${sessionId || "call"}.webm`);
  formData.append("model", "whisper-1");
  formData.append("response_format", "verbose_json");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Whisper API failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const segments = (data.segments || []).map((s: any, idx: number) => ({
    id: idx,
    start: s.start,
    end: s.end,
    text: (s.text || "").trim(),
  }));

  return {
    text: data.text || "",
    segments,
  };
}

export async function diarizeTranscriptWithGrok(
  segments: Array<{ id: number; start: number; end: number; text: string }>
): Promise<DiarizedTurn[]> {
  const xaiKey = process.env.XAI_API_KEY;
  const grokModel = process.env.GROK_MODEL || "grok-4.20-0309-non-reasoning";

  if (!xaiKey) {
    throw new Error("Missing XAI_API_KEY in environment");
  }

  const formattedSegments = segments.map((s) => ({
    id: s.id,
    time: `${Math.round(s.start)}-${Math.round(s.end)}s`,
    text: s.text,
  }));

  const prompt = `You are a conversational audio diarization engine.
Below are the exact transcribed audio segments from a video call between Max (the AI Digital Finance Manager at a car dealership) and a Caller (the customer).

Context:
- Max is the AI avatar. He greets the customer, introduces himself as Max the Digital Finance Manager, presents vehicle protection options ("Mazda is like any other manufacturer when they build..."), answers questions, and asks "Are you there?" when interrupted or when silence occurs.
- Caller is the human customer who replies ("Sup Max", "Hey there, yes, I can hear and see you...", "Hey hey hey hey, listen, listen", "What's your name?", "Yeah", "Is this a sales call?").

Review each segment and accurately assign the speaker and role.
Output ONLY a JSON array of objects with the structure:
[
  {
    "id": number,
    "role": "assistant" | "user",
    "speaker": "Max (AI)" | "Caller",
    "time": string,
    "text": string
  }
]`;

  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${xaiKey}`,
    },
    body: JSON.stringify({
      model: grokModel,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content:
            "You format and diarize transcripts as valid JSON only without markdown code blocks, explanation or formatting tags.",
        },
        {
          role: "user",
          content: prompt + "\n\nSegments:\n" + JSON.stringify(formattedSegments, null, 2),
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Grok diarization failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const rawText = data.choices?.[0]?.message?.content || "[]";
  const cleaned = rawText.replace(/```json/gi, "").replace(/```/g, "").trim();

  try {
    const diarized: DiarizedTurn[] = JSON.parse(cleaned);
    return diarized;
  } catch (parseErr) {
    console.error("[diarize] Failed to parse Grok JSON:", cleaned);
    return formattedSegments.map((s) => ({
      id: s.id,
      role: "user" as const,
      speaker: "Speaker",
      time: s.time,
      text: s.text,
    }));
  }
}

export async function processAndSaveCallTranscription(
  sessionId: string,
  audioBuffer: Buffer
): Promise<{ success: boolean; turnsCount: number; transcript: DiarizedTurn[] }> {
  console.log(`[transcription-service] Transcribing audio for session ${sessionId} (${audioBuffer.byteLength} bytes)...`);

  // Step 1: Whisper speech-to-text
  const whisperResult = await transcribeAudioBuffer(audioBuffer, sessionId);
  console.log(`[transcription-service] Whisper extracted ${whisperResult.segments.length} segments`);

  if (whisperResult.segments.length === 0) {
    return { success: true, turnsCount: 0, transcript: [] };
  }

  // Step 2: Grok speaker diarization
  const diarizedTurns = await diarizeTranscriptWithGrok(whisperResult.segments);
  console.log(`[transcription-service] Grok diarized ${diarizedTurns.length} turns`);

  // Step 3: Update existing session JSON log
  const existingLog = getHeygenTranscript(sessionId) || {
    sessionId,
    engine: "heygen-grok" as const,
    avatarId: "heygen-liveavatar",
    avatarName: "Max",
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    durationSeconds: null,
    status: "completed" as const,
    productsCovered: [],
    finalDailyRate: 4.0,
    transcript: [],
  };

  const updatedLog = {
    ...existingLog,
    transcriptionModel: "openai-whisper-1 + grok-diarization",
    transcript: diarizedTurns.map((t) => ({
      role: t.role,
      speaker: t.speaker,
      time: t.time,
      text: t.text,
      timestamp: new Date().toISOString(),
    })),
  };

  saveHeygenTranscript(updatedLog as any);
  console.log(`[transcription-service] Successfully updated logs-heygen/${sessionId}.json with high-accuracy transcript`);

  return {
    success: true,
    turnsCount: diarizedTurns.length,
    transcript: diarizedTurns,
  };
}
