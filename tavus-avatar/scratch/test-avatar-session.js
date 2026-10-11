const https = require('https');
const { Room, RoomEvent, Track } = require('livekit-client');

const apiKey = '3273236a-3dd8-451c-b252-f3d07fad7548';
const avatarId = 'd5343dec-c81a-4b0e-90ef-6808924f38d1';

function post(url, body, headers = {}) {
  return new Promise((resolve) => {
    const postData = JSON.stringify(body);
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...headers
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', err => resolve({ error: err.message }));
    req.write(postData);
    req.end();
  });
}

async function testSession() {
  console.log("Step 1: Creating session token for avatar:", avatarId);
  const tokenRes = await post('https://api.liveavatar.com/v1/sessions/token', {
    mode: 'FULL',
    avatar_id: avatarId,
    avatar_persona: {
      voice_id: 'b952f553-f7f3-4e52-8625-86b4c415384f',
      language: 'en'
    }
  }, { 'X-API-KEY': apiKey });

  console.log("Token response status:", tokenRes.status);
  const sessionToken = tokenRes.data?.data?.session_token;
  if (!sessionToken) {
    console.error("No session token:", tokenRes);
    return;
  }

  console.log("Step 2: Starting session...");
  const startRes = await post('https://api.liveavatar.com/v1/sessions/start', {}, {
    Authorization: `Bearer ${sessionToken}`
  });

  console.log("Start response status:", startRes.status);
  console.log("Start response data:", JSON.stringify(startRes.data, null, 2));

  const livekitUrl = startRes.data?.data?.livekit_url;
  const livekitClientToken = startRes.data?.data?.livekit_client_token;

  if (!livekitUrl || !livekitClientToken) {
    console.error("Missing LiveKit credentials!");
    return;
  }

  console.log("\nStep 3: Connecting to LiveKit room:", livekitUrl);
  // We can't use full browser WebRTC in standard node without webrtc polyfill, but we can inspect the response:
  // Is livekit_url valid? What is the status of the session in LiveAvatar API?
  const sessStatus = await new Promise((resolve) => {
    https.get(`https://api.liveavatar.com/v1/sessions/${startRes.data?.data?.session_id}`, {
      headers: { 'X-API-KEY': apiKey }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    });
  });
  console.log("Session detail:", sessStatus);

  // Stop session
  await post('https://api.liveavatar.com/v1/sessions/stop', {}, {
    Authorization: `Bearer ${sessionToken}`
  });
  console.log("Session stopped.");
}

testSession();
