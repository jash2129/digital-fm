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
  const FALLBACK_PUBLIC_PREVIEW =
    "https://files2.heygen.ai/avatar/v3/e20ac0c902184ff793e75ae4e139b7dc_45600/preview_target.webp";

  // Verify avatar status
  let effectiveAvatarId = requestedAvatarId;
  let effectiveVoiceId = FALLBACK_PUBLIC_VOICE_ID;
  let avatarName = "Max (Finance Manager)";
  let avatarPreviewUrl: string | null = FALLBACK_PUBLIC_PREVIEW;
  let isCustomAvatar = false;

  try {
    // 1. Check custom avatars first
    const listRes = await fetch(`${LIVEAVATAR_API_BASE}/avatars`, {
      headers: { "X-API-KEY": apiKey },
      cache: "no-store",
    });
    let foundAvatar: any = null;
    if (listRes.ok) {
      const listData = await listRes.json();
      foundAvatar = listData.data?.results?.find((a: any) => a.id === requestedAvatarId);
      if (foundAvatar) {
        avatarPreviewUrl = foundAvatar.preview_url || FALLBACK_PUBLIC_PREVIEW;
        if (foundAvatar.status === "ACTIVE") {
          effectiveAvatarId = foundAvatar.id;
          avatarName = `Max (${foundAvatar.name || "novus.ai6"} - Verified)`;
          isCustomAvatar = true;
          if (foundAvatar.default_voice?.id) {
            effectiveVoiceId = foundAvatar.default_voice.id;
          }
        }
      }
    }

    // 2. If not a custom avatar, check public avatars
    if (!foundAvatar) {
      const publicRes = await fetch(`${LIVEAVATAR_API_BASE}/avatars/public?page_size=50`, {
        headers: { "X-API-KEY": apiKey },
        cache: "no-store",
      });
      if (publicRes.ok) {
        const publicData = await publicRes.json();
        const pubAvatar =
          publicData.data?.results?.find((a: any) => a.id === requestedAvatarId) ||
          publicData.data?.results?.find((a: any) => a.id === FALLBACK_PUBLIC_AVATAR_ID);
        if (pubAvatar) {
          effectiveAvatarId = pubAvatar.id;
          effectiveVoiceId = pubAvatar.default_voice?.id || FALLBACK_PUBLIC_VOICE_ID;
          avatarName = `Max (${pubAvatar.name || "Default Avatar"})`;
          avatarPreviewUrl = pubAvatar.preview_url || FALLBACK_PUBLIC_PREVIEW;
        }
      }
    }
  } catch (err) {
    console.warn("[liveavatar] Could not check avatar list, using fallback public avatar:", err);
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
