import os
import sys
import json
import urllib.request
import urllib.error

# Read OpenAI key from .env.local
env_path = os.path.join(os.path.dirname(__file__), "..", ".env.local")
openai_key = None
if os.path.exists(env_path):
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("OPENAI_API_KEY="):
                openai_key = line.split("=", 1)[1].strip()
                break

if not openai_key:
    openai_key = os.environ.get("OPENAI_API_KEY")

if not openai_key:
    print("ERROR: Missing OPENAI_API_KEY")
    sys.exit(1)

webm_path = os.path.join(os.path.dirname(__file__), "..", "logs-heygen", "91f39e24-df03-40fc-8a7d-7dc77a737fc2.webm")
if not os.path.exists(webm_path):
    print("ERROR: webm file not found at", webm_path)
    sys.exit(1)

print(f"Transcribing {os.path.basename(webm_path)} ({os.path.getsize(webm_path)} bytes) via Whisper verbose_json...")

boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
with open(webm_path, "rb") as f:
    file_bytes = f.read()

body = bytearray()
# file field
body.extend(f"--{boundary}\r\n".encode("utf-8"))
body.extend(b'Content-Disposition: form-data; name="file"; filename="call.webm"\r\n')
body.extend(b"Content-Type: audio/webm\r\n\r\n")
body.extend(file_bytes)
body.extend(b"\r\n")

# model field
body.extend(f"--{boundary}\r\n".encode("utf-8"))
body.extend(b'Content-Disposition: form-data; name="model"\r\n\r\n')
body.extend(b"whisper-1\r\n")

# response_format field
body.extend(f"--{boundary}\r\n".encode("utf-8"))
body.extend(b'Content-Disposition: form-data; name="response_format"\r\n\r\n')
body.extend(b"verbose_json\r\n")

body.extend(f"--{boundary}--\r\n".encode("utf-8"))

req = urllib.request.Request("https://api.openai.com/v1/audio/transcriptions", data=body)
req.add_header("Authorization", f"Bearer {openai_key}")
req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")

try:
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read().decode("utf-8"))
except Exception as e:
    print("Whisper request failed:", e)
    sys.exit(1)

segments = result.get("segments", [])
print(f"Received {len(segments)} segments from Whisper.")

# Save segments to scratch file
scratch_out = os.path.join(os.path.dirname(__file__), "..", "logs-heygen", "91f39e24_segments.json")
with open(scratch_out, "w", encoding="utf-8") as f:
    json.dump(segments, f, indent=2)

print(f"Segments saved to {scratch_out}")
