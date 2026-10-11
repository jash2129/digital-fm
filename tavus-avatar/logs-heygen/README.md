# HeyGen + Grok Call Logs & Audio Recordings

This directory stores all session transcripts and audio recordings generated during **HeyGen LiveAvatar + Grok** consultations.

## File Format

For each consultation session (`sessionId`), two files are created:

1. **`<sessionId>.json`**: Structured JSON transcript
   - Full conversation history (user messages, Max's responses)
   - Timestamps and turn duration
   - F&I products discussed (`vsc`, `tire_wheel`, `maintenance`, `gap`)
   - Final agreed daily rate and discount ladder stage
   - Call status (`completed` or `abandoned`)

2. **`<sessionId>.webm`**: Dual-track WebM audio recording
   - Combined audio stream of both the user's microphone and Max's speech
   - Standard Opus audio encoding compatible with web browsers and media players

## Access via API

- **Fetch Transcript**: `GET /api/heygen/logs/{sessionId}`
- **Stream Audio**: `GET /api/heygen/logs/{sessionId}/audio`
