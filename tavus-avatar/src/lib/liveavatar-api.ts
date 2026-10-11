import "server-only";

const LIVEAVATAR_API_BASE = "https://api.liveavatar.com/v1";
const FALLBACK_PUBLIC_AVATAR_ID = "0930fd59-c8ad-434d-ad53-b391a1768720"; // Dexter Lawyer (Active)
const FALLBACK_PUBLIC_VOICE_ID = "b952f553-f7f3-4e52-8625-86b4c415384f"; // Dexter - Professional

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

  const requestedAvatarId = process.env.HEYGEN_AVATAR_ID?.trim() || FALLBACK_PUBLIC_AVATAR_ID;

  // Verify avatar status
  let effectiveAvatarId = requestedAvatarId;
  let effectiveVoiceId = FALLBACK_PUBLIC_VOICE_ID;
  let avatarName = "Finance Manager Max";
  let avatarPreviewUrl: string | null = null;
  let isCustomAvatar = false;

  try {
    const listRes = await fetch(`${LIVEAVATAR_API_BASE}/avatars`, {
      headers: { "X-API-KEY": apiKey },
      cache: "no-store",
    });
    if (listRes.ok) {
      const listData = await listRes.json();
      const userAvatar =
        listData.data?.results?.find((a: any) => a.id === requestedAvatarId) ||
        listData.data?.results?.[0];

      if (userAvatar) {
        avatarPreviewUrl = userAvatar.preview_url || null;
        if (userAvatar.status === "ACTIVE") {
          effectiveAvatarId = userAvatar.id;
          avatarName = `Max (${userAvatar.name || "novus.ai6"} - Verified)`;
          isCustomAvatar = true;
          if (userAvatar.default_voice?.id) {
            effectiveVoiceId = userAvatar.default_voice.id;
          }
        } else {
          console.warn(
            `[liveavatar] Custom avatar ${userAvatar.id} is currently "${userAvatar.status}". Using active public avatar stream until deployment completes.`
          );
          effectiveAvatarId = FALLBACK_PUBLIC_AVATAR_ID;
          effectiveVoiceId = FALLBACK_PUBLIC_VOICE_ID;
          avatarName = `Max (${userAvatar.name || "novus.ai6"} - Deploying)`;
        }
      }
    }
  } catch (err) {
    console.warn("[liveavatar] Could not check avatar list, attempting requested avatar directly:", err);
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
