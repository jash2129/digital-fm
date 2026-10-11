import json
import os

segments_path = os.path.join(os.path.dirname(__file__), "..", "logs-heygen", "91f39e24_segments.json")
transcript_path = os.path.join(os.path.dirname(__file__), "..", "logs-heygen", "91f39e24-df03-40fc-8a7d-7dc77a737fc2.json")

with open(segments_path, "r", encoding="utf-8") as f:
    segments = json.load(f)

with open(transcript_path, "r", encoding="utf-8") as f:
    session_data = json.load(f)

print("=" * 80)
print("FULL AUDIO TIMELINE (91f39e24-df03-40fc-8a7d-7dc77a737fc2.webm)")
print("=" * 80)

for idx, s in enumerate(segments):
    print(f"[{idx:02d}] {s['start']:6.2f}s - {s['end']:6.2f}s | {s['text']}")
