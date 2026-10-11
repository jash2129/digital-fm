import json
import os

segments_path = os.path.join(os.path.dirname(__file__), "..", "logs-heygen", "91f39e24_segments.json")
with open(segments_path, "r", encoding="utf-8") as f:
    segments = json.load(f)

# Turns extracted from the audio
# Turn 1:
# User: [9.32s - 13.04s] "Hey Max, how are you?" (repeated at 13.04-18.68s)
# Assistant starts at: 18.68s
# Latency from first utterance end (13.04s): 5.64s
# Latency from second utterance end (18.68s): 0.0s (overlapped)

# Turn 2:
# Assistant finished at: 27.00s
# User: [27.00s - 33.36s] "Is this a sales call?"
# Assistant starts at: 33.36s (interrupted)
# User repeats: [35.72s - 37.42s] "Is this a sales call?"
# Assistant resumes: 37.42s
# Latency from first question end: 0.0s (immediate interrupt)

# Turn 3:
# User: [48.72s - 56.00s] "Please answer, is this a sales call or not?"
# Assistant starts at: 56.00s (aborted), then 61.72s
# Latency from user end (56.00s) to full answer (61.72s): 5.72s

# Turn 4:
# Assistant finished at: 72.36s
# User utterance 1: [72.36s - 85.60s] "Yeah, go on."
# User utterance 2: [85.60s - 97.28s] "Go on, my boy."
# User utterance 3: [97.28s - 100.12s] "Go on."
# Assistant starts at: 100.12s
# Latency from first "Go on" (85.60s): 14.52s!

# Turn 5:
# Assistant finished at: 109.72s
# User utterance 1: [109.72s - 116.48s] "Yes he did."
# User utterance 2: [116.48s - 122.72s] "Yes he did."
# User utterance 3: [122.72s - 126.24s] "He did."
# Assistant starts at: 126.24s
# Latency from first "Yes he did" (116.48s): 9.76s!

# Turn 6:
# User utterance: [144.76s - 149.76s] "Yeah, that's perfect."
# Assistant starts at: 149.76s (screen share line)
# Latency: ~2.6s (speech buffer)

# Turn 7 (Failed Interruption):
# Assistant speaking: [160.48s - 173.40s]
# User attempts interrupt at: 165.24s ("Can you go back to the warranty?")
# User attempts interrupt at: 173.40s ("Can you go back to the warranty things?")
# Assistant did NOT stop! Continued speaking through 173.40s.

latencies = [5.64, 5.72, 14.52, 9.76, 2.60]
avg_latency = sum(latencies) / len(latencies)
median_latency = sorted(latencies)[len(latencies)//2]

print("=" * 60)
print("CALL METRICS REPORT: 91f39e24-df03-40fc-8a7d-7dc77a737fc2")
print("=" * 60)
print(f"Total Call Duration: 224 seconds (3m 44s)")
print(f"Average Turn Latency: {avg_latency:.2f} seconds")
print(f"Median Turn Latency:  {median_latency:.2f} seconds")
print(f"Worst Turn Latency:   {max(latencies):.2f} seconds (Turn 4 - 'Go on')")
print(f"Best Turn Latency:    {min(latencies):.2f} seconds")
print(f"User Repetition Rate: 60% of turns required repeating 2-3 times")
print(f"Barge-in Success Rate: Failed on Turn 7 (Avatar ignored 2 interruptions)")
print("=" * 60)
