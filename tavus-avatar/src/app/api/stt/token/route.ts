import { NextResponse } from "next/server";

// A short-lived Deepgram token for the browser's speech-to-text stream (src/lib/deepgram-stt.ts).
// The API key stays on the server; the token only needs to be valid when the WebSocket opens.
// Behind the DEMO_API_TOKEN gate like every /api route. Without DEEPGRAM_API_KEY it answers 503
// and the call screen falls back to the browser's speech recognition.
const TOKEN_TTL_SECONDS = 60;

export async function POST() {
  const key = process.env.DEEPGRAM_API_KEY?.trim();
  if (!key) return NextResponse.json({ error: "DEEPGRAM_API_KEY is not set" }, { status: 503 });

  try {
    const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl_seconds: TOKEN_TTL_SECONDS }),
    });
    if (!res.ok) {
      console.error(`[stt/token] Deepgram answered ${res.status}`);
      return NextResponse.json({ error: `Deepgram answered ${res.status}` }, { status: 502 });
    }
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return NextResponse.json({ error: "no token in Deepgram's reply" }, { status: 502 });
    return NextResponse.json({ token: data.access_token, expiresIn: data.expires_in ?? TOKEN_TTL_SECONDS });
  } catch (err) {
    console.error("[stt/token] token request failed:", err);
    return NextResponse.json({ error: "could not reach Deepgram" }, { status: 502 });
  }
}
