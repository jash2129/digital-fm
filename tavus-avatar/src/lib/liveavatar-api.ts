import "server-only";

const LIVEAVATAR_API_BASE = "https://api.liveavatar.com/v1";
const DEFAULT_AVATAR_ID = "0930fd59-c8ad-434d-ad53-b391a1768720"; // Dexter Lawyer (US English Accent)
const FALLBACK_PUBLIC_AVATAR_ID = "0930fd59-c8ad-434d-ad53-b391a1768720"; // Dexter Lawyer
const FALLBACK_PUBLIC_VOICE_ID = "b952f553-f7f3-4e52-8625-86b4c415384f"; // Dexter - Professional (US English)

export type LiveAvatarSessionResult = {
  sessionId: string;
  sessionToken: string;
  livekitUrl: string;
  livekitClientToken: string;
  maxSessionDuration: number;
  avatarId: string;
  avatarName: string;
  avatarPreviewUrl?: string | null;
  isCustomAvatar: boolean;
};

export async function createLiveAvatarSession(): Promise<LiveAvatarSessionResult> {
  const apiKey = process.env.HEYGEN_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing HEYGEN_API_KEY in environment variables.");
  }

  const requestedAvatarId = process.env.HEYGEN_AVATAR_ID?.trim() || DEFAULT_AVATAR_ID;
  const FALLBACK_PUBLIC_PREVIEW =
    "https://files2.heygen.ai/avatar/v3/e20ac0c902184ff793e75ae4e139b7dc_45600/preview_target.webp";

  // Verify avatar status
  let effectiveAvatarId = requestedAvatarId;
  let effectiveVoiceId = FALLBACK_PUBLIC_VOICE_ID;
  let avatarName = "Max (Finance Manager)";
  let avatarPreviewUrl: string | null = FALLBACK_PUBLIC_PREVIEW;
  let isCustomAvatar = false;

  try {
    // 1. Direct avatar lookup (works for custom or public avatars)
    const avatarRes = await fetch(`${LIVEAVATAR_API_BASE}/avatars/${requestedAvatarId}`, {
      headers: { "X-API-KEY": apiKey },
      cache: "no-store",
    });
    if (avatarRes.ok) {
      const avatarData = await avatarRes.json();
      const foundAvatar = avatarData.data;
      if (foundAvatar && foundAvatar.status === "ACTIVE") {
        effectiveAvatarId = foundAvatar.id;
        avatarName = `Max (${foundAvatar.name || "Finance Manager"} - Verified)`;
        avatarPreviewUrl = foundAvatar.preview_url || FALLBACK_PUBLIC_PREVIEW;
        isCustomAvatar = Boolean(foundAvatar.space_id);
        if (foundAvatar.default_voice?.id) {
          effectiveVoiceId = foundAvatar.default_voice.id;
        }
      }
    } else {
      console.warn(`[liveavatar] Avatar ${requestedAvatarId} returned status ${avatarRes.status}, falling back to public avatar`);
      effectiveAvatarId = FALLBACK_PUBLIC_AVATAR_ID;
      effectiveVoiceId = FALLBACK_PUBLIC_VOICE_ID;
    }
  } catch (err) {
    console.warn("[liveavatar] Could not check avatar details, using fallback public avatar:", err);
    effectiveAvatarId = FALLBACK_PUBLIC_AVATAR_ID;
    effectiveVoiceId = FALLBACK_PUBLIC_VOICE_ID;
  }

  // Step 1: Create session token
  const tokenRes = await fetch(`${LIVEAVATAR_API_BASE}/sessions/token`, {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mode: "FULL",
      avatar_id: effectiveAvatarId,
      avatar_persona: {
        voice_id: effectiveVoiceId,
        language: "en",
      },
    }),
  });

  const tokenText = await tokenRes.text();
  let tokenData: any;
  try {
    tokenData = JSON.parse(tokenText);
  } catch {
    throw new Error(`LiveAvatar token error (${tokenRes.status}): ${tokenText}`);
  }

  if (!tokenRes.ok || !tokenData.data?.session_token) {
    throw new Error(tokenData.message || `Failed to create LiveAvatar token: ${tokenText}`);
  }

  const sessionToken = tokenData.data.session_token;
  const sessionId = tokenData.data.session_id;

  // Step 2: Start session to retrieve WebRTC LiveKit credentials
  const startRes = await fetch(`${LIVEAVATAR_API_BASE}/sessions/start`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sessionToken}`,
      "Content-Type": "application/json",
    },
  });

  const startText = await startRes.text();
  let startData: any;
  try {
    startData = JSON.parse(startText);
  } catch {
    throw new Error(`LiveAvatar start error (${startRes.status}): ${startText}`);
  }

  if (!startRes.ok || !startData.data?.livekit_url) {
    throw new Error(startData.message || `Failed to start LiveAvatar session: ${startText}`);
  }

  return {
    sessionId: startData.data.session_id || sessionId,
    sessionToken,
    livekitUrl: startData.data.livekit_url,
    livekitClientToken: startData.data.livekit_client_token,
    maxSessionDuration: startData.data.max_session_duration || 1200,
    avatarId: effectiveAvatarId,
    avatarName,
    avatarPreviewUrl,
    isCustomAvatar,
  };
}

export async function stopLiveAvatarSession(sessionToken: string): Promise<void> {
  try {
    await fetch(`${LIVEAVATAR_API_BASE}/sessions/stop`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    console.warn("[liveavatar] Error stopping session:", err);
  }
}
