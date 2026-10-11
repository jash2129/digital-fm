#!/usr/bin/env python3
"""
calculate-latency.py

Reads per-turn timing logs and barge-in metrics from logs-heygen/ session files.
Calculates and reports:
  - Per-turn breakdown: user_speech_end, final_transcript, controller_decision, speak_sent, avatar_audio_start and gaps
  - Median and worst (max) turn latency
  - Barge-in count and how many were honored
"""

import os
import sys
import json
import glob
import statistics

def find_target_log(args):
    script_dir = os.path.dirname(os.path.abspath(__file__))
    logs_dir = os.path.normpath(os.path.join(script_dir, "..", "logs-heygen"))

    if len(args) > 1:
        target = args[1]
        if os.path.isfile(target):
            return target
        candidate = os.path.join(logs_dir, target if target.endswith(".json") else f"{target}.json")
        if os.path.isfile(candidate):
            return candidate

    # Find the most recently modified session JSON file in logs-heygen/
    json_files = glob.glob(os.path.join(logs_dir, "*.json"))
    # Exclude segment scratch files
    json_files = [f for f in json_files if not f.endswith("_segments.json")]
    if not json_files:
        print(f"No session logs found in {logs_dir}")
        return None

    json_files.sort(key=lambda p: os.path.getmtime(p), reverse=True)
    return json_files[0]

def analyze_log_file(filepath):
    print("=" * 80)
    print(f"DIGITAL FINANCE MANAGER (MAX) — LATENCY & BARGE-IN BENCHMARK REPORT")
    print(f"Log File: {os.path.abspath(filepath)}")
    print("=" * 80)

    try:
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        print(f"Error reading JSON from {filepath}: {e}")
        return

    session_id = data.get("sessionId", "Unknown")
    avatar_name = data.get("avatarName", "Max")
    start_time = data.get("startTime", "Unknown")
    timing_logs = data.get("timingLogs", [])
    barge_ins = data.get("bargeIns", [])

    print(f"Session ID:  {session_id}")
    print(f"Avatar:      {avatar_name}")
    print(f"Start Time:  {start_time}")
    print("-" * 80)

    if not timing_logs:
        # Check if transcript contains any timestamped turns
        transcript = data.get("transcript", [])
        print(f"Notice: No structured 'timingLogs' array in this session log yet.")
        print(f"Found {len(transcript)} transcript utterances in session.")
        return

    print(f"\n[PER-TURN LATENCY BREAKDOWN] ({len(timing_logs)} turns measured):")
    latencies_ms = []

    for idx, turn in enumerate(timing_logs, start=1):
        turn_id = turn.get("turnId", idx)
        user_input = turn.get("userInput", "").strip()
        avatar_text = turn.get("avatarText", "").strip()
        gaps = turn.get("gaps", {})
        timestamps = turn.get("timestamps", {})

        transcription_gap = gaps.get("transcription_gap_ms", 0)
        controller_gap = gaps.get("controller_gap_ms", 0)
        speak_sent_gap = gaps.get("speak_sent_gap_ms", 0)
        avatar_render_gap = gaps.get("avatar_render_gap_ms", 0)
        total_latency = gaps.get("total_latency_ms", 0)

        latencies_ms.append(total_latency)

        print(f"\nTurn #{turn_id}:")
        print(f"  Caller:  \"{user_input[:80]}{'...' if len(user_input) > 80 else ''}\"")
        print(f"  Max:     \"{avatar_text[:80]}{'...' if len(avatar_text) > 80 else ''}\"")
        print(f"  Timing Gaps:")
        print(f"    • user_speech_end -> final_transcript:       {transcription_gap:>5} ms  (VAD / silence detection)")
        print(f"    • final_transcript -> controller_decision:   {controller_gap:>5} ms  (Beat classifier / decision)")
        print(f"    • controller_decision -> speak_sent:         {speak_sent_gap:>5} ms  (WebRTC data channel publish)")
        print(f"    • speak_sent -> avatar_audio_start:          {avatar_render_gap:>5} ms  (LiveAvatar synthesis & WebRTC buffer)")
        print(f"    -------------------------------------------------------")
        print(f"    TOTAL TURN LATENCY:                          {total_latency:>5} ms  ({(total_latency / 1000):.2f} s)")

    # Aggregate Statistics
    median_latency = statistics.median(latencies_ms) if latencies_ms else 0
    worst_latency = max(latencies_ms) if latencies_ms else 0
    best_latency = min(latencies_ms) if latencies_ms else 0
    mean_latency = statistics.mean(latencies_ms) if latencies_ms else 0

    print("\n" + "=" * 80)
    print("SUMMARY LATENCY METRICS:")
    print("=" * 80)
    print(f"  Total Turns Measured:       {len(latencies_ms)}")
    print(f"  Best (Min) Turn Latency:    {best_latency:>6} ms  ({(best_latency / 1000):.2f} s)")
    print(f"  Median Turn Latency:        {median_latency:>6.0f} ms  ({(median_latency / 1000):.2f} s)")
    print(f"  Mean Turn Latency:          {mean_latency:>6.1f} ms  ({(mean_latency / 1000):.2f} s)")
    print(f"  Worst (Max) Turn Latency:   {worst_latency:>6} ms  ({(worst_latency / 1000):.2f} s)")

    # Barge-In Statistics
    total_barge_ins = len(barge_ins)
    honored_barge_ins = sum(1 for b in barge_ins if b.get("honored", False))
    honor_rate = (honored_barge_ins / total_barge_ins * 100) if total_barge_ins > 0 else 100.0

    print("\n" + "=" * 80)
    print("BARGE-IN METRICS:")
    print("=" * 80)
    print(f"  Total Barge-In Attempts:    {total_barge_ins}")
    print(f"  Honored Barge-Ins:          {honored_barge_ins}")
    print(f"  Honored Rate:               {honor_rate:.1f}%")

    if barge_ins:
        print("\n  Barge-In Details:")
        for b_idx, b in enumerate(barge_ins, 1):
            status = "HONORED [Muted + Interrupted]" if b.get("honored") else "IGNORED"
            trigger = b.get("spokenText", "N/A")
            interrupted = b.get("avatarTextWhenInterrupted", "N/A")
            print(f"    [{b_idx}] {status} | Trigger: \"{trigger}\" | While Max said: \"{interrupted[:50]}...\"")

    print("\n" + "=" * 80)

if __name__ == "__main__":
    target_file = find_target_log(sys.argv)
    if target_file:
        analyze_log_file(target_file)
    else:
        sys.exit(1)
