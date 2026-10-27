#!/usr/bin/env python3
"""
AI Voice Agent Testing Skill — CLI Test Runner
Executes comprehensive automated testing across:
- TEXT mode: Fast, 0-credit script & business logic testing
- MOCK_VOICE mode: Simulated protocol test (0 credits, verifies controller cutoffs, labeled as SIMULATED_PROTOCOL_ONLY)
- REAL_VOICE mode: Live HeyGen LiveAvatar WebRTC session (consumes credits, measures true WebRTC streaming latency & barge-ins)
"""

import os
import sys
import json
import time
import argparse
import subprocess
from pathlib import Path
from typing import Dict, List, Any, Optional

from customer_simulator import CustomerSimulator
from transcript_logger import TranscriptLogger
from verbatim_checker import VerbatimChecker
from flow_judge import FlowJudge
from prompt_fixer import PromptFixer
from report_generator import ReportGenerator

BASE_DIR = Path(__file__).parent
BRIDGE_PATH = BASE_DIR / "agent_bridge.mjs"

def load_env_local():
    """Load environment variables from tavus-avatar/.env.local if present."""
    env_file = BASE_DIR.parent / "tavus-avatar" / ".env.local"
    if env_file.exists():
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, val = line.split("=", 1)
                    if key.strip() not in os.environ:
                        os.environ[key.strip()] = val.strip()

load_env_local()

class AgentClient:
    """Invokes the agent either via persistent local TSX worker or via HTTP."""
    def __init__(self, endpoint: Optional[str] = None):
        self.endpoint = endpoint
        self.proc = None
        if not self.endpoint:
            self._start_worker()

    def _start_worker(self):
        cmd = "npx tsx agent_bridge.mjs"
        self.proc = subprocess.Popen(
            cmd,
            shell=True,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=str(BASE_DIR),
            text=True,
            bufsize=1
        )

    def call_turn(self, session_id: str, user_transcript: str, reset: bool = False) -> Dict[str, Any]:
        if self.endpoint:
            import requests
            res = requests.post(
                self.endpoint,
                json={
                    "sessionId": session_id,
                    "messages": [{"role": "user", "content": user_transcript}]
                },
                timeout=15
            )
            data = res.json()
            return {
                "textToSpeak": data.get("text", ""),
                "beatId": data.get("currentBeatId", 0),
                "beatType": data.get("beatType", "wait"),
                "intent": data.get("intent", "other"),
                "stageId": "DISCLOSURE" if data.get("currentBeatId") == 1 else "GENERAL",
                "toolCalls": data.get("toolCalls", []),
                "latencyMs": 150
            }

        payload = json.dumps({
            "action": "turn",
            "sessionId": session_id,
            "userTranscript": user_transcript,
            "reset": reset
        })

        if not self.proc or self.proc.poll() is not None:
            self._start_worker()

        self.proc.stdin.write(f"{payload}\n")
        self.proc.stdin.flush()

        line = self.proc.stdout.readline().strip()
        while line and not line.startswith("{"):
            line = self.proc.stdout.readline().strip()

        if not line:
            err = self.proc.stderr.read() if self.proc.stderr else "Unknown error"
            raise RuntimeError(f"Bridge worker output empty. Stderr: {err}")

        return json.loads(line)

    def close(self):
        if self.proc:
            try:
                self.proc.terminate()
            except Exception:
                pass

def run_single_text_test(
    persona_id: str,
    simulator: CustomerSimulator,
    agent_client: AgentClient,
    max_turns: int = 32,
    use_llm: bool = False
) -> Dict[str, Any]:
    persona = simulator.get_persona(persona_id)
    if not persona:
        raise ValueError(f"Unknown persona {persona_id}")

    test_id = f"test_{persona_id}_{int(time.time())}"
    session_id = f"sess_{test_id}"
    logger = TranscriptLogger(test_id=test_id, persona_id=persona_id, mode="TEXT")

    print(f"\n================================================================================", flush=True)
    print(f"RUNNING TEXT TEST: {persona['name']} (`{persona_id}`)", flush=True)
    print(f"Mode: TEXT (0 Credits) | Goal: {persona['description']}", flush=True)
    print(f"================================================================================", flush=True)

    agent_turn = agent_client.call_turn(session_id, "Hello", reset=True)
    logger.log_turn(
        role="assistant",
        speaker="Max (AI)",
        text=agent_turn.get("textToSpeak", "Can you hear and see me alright?"),
        stage_id=agent_turn.get("stageId", "GREETING"),
        intent=agent_turn.get("intent", "greeting"),
        latency_ms=agent_turn.get("latencyMs", 10),
        tool_calls=agent_turn.get("toolCalls", [])
    )
    print(f"🤖 Max (AI): {agent_turn.get('textToSpeak')}", flush=True)

    dialogue_history = [{"role": "assistant", "content": agent_turn.get("textToSpeak")}]
    current_stage = agent_turn.get("stageId", "GREETING")

    for turn_idx in range(1, max_turns + 1):
        cust_reply = simulator.generate_reply(
            persona_id=persona_id,
            dialogue_history=dialogue_history,
            current_stage=current_stage,
            interruption_requested=False,
            use_llm=use_llm
        )
        user_text = cust_reply["text"]
        logger.log_turn(
            role="user",
            speaker=f"Customer ({persona['name']})",
            text=user_text,
            stage_id=current_stage,
            is_interruption=cust_reply.get("is_interruption", False)
        )
        print(f"👤 Customer: {user_text}", flush=True)
        dialogue_history.append({"role": "user", "content": user_text})

        start_t = time.time()
        agent_turn = agent_client.call_turn(session_id, user_text, reset=False)
        agent_latency = int((time.time() - start_t) * 1000)

        max_text = agent_turn.get("textToSpeak", "")
        current_stage = agent_turn.get("stageId", current_stage)
        logger.log_turn(
            role="assistant",
            speaker="Max (AI)",
            text=max_text,
            stage_id=current_stage,
            intent=agent_turn.get("intent", ""),
            latency_ms=agent_latency,
            tool_calls=agent_turn.get("toolCalls", [])
        )
        print(f"🤖 Max (AI) [Stage: {current_stage}]: {max_text}")
        dialogue_history.append({"role": "assistant", "content": max_text})

        if agent_turn.get("isScriptComplete") or "colleague to go over the rest" in max_text:
            print("🏁 Consultation reached terminal conclusion.")
            break

    final_transcript = logger.finalize(status="completed")
    return final_transcript

def run_single_mock_voice_test(
    persona_id: str,
    simulator: CustomerSimulator,
    agent_client: AgentClient
) -> Dict[str, Any]:
    """
    Mock Voice Mode: Tests state-machine barge-in handling and protocol milestones
    in memory (0 HeyGen credits). Explicitly labeled as MOCK_VOICE / SIMULATED_PROTOCOL_ONLY.
    """
    persona = simulator.get_persona(persona_id) or simulator.get_persona("interrupting_buyer")
    test_id = f"mock_voice_{persona['id']}_{int(time.time())}"
    session_id = f"mock_voice_sess_{test_id}"
    logger = TranscriptLogger(test_id=test_id, persona_id=persona["id"], mode="MOCK_VOICE")

    print(f"\n================================================================================")
    print(f"RUNNING MOCK VOICE TEST (Simulated Protocol, 0 HeyGen Credits): {persona['name']}")
    print(f"Milestones: 4 Predefined Interruption Points (Disclosure, Warranty, Offer, Price)")
    print(f"NOTICE: This is a protocol simulation and does NOT qualify as passed voice validation.")
    print(f"================================================================================")

    interruption_milestones = [
        ("DISCLOSURE", "during_disclosure", "Wait, hold on a second! Why are you recording me, who is this?"),
        ("PRESENTATION_WARRANTY", "during_warranty", "Let me tell you something! The salesperson said the car comes with warranty!"),
        ("PRODUCT_OFFER", "during_offer", "Stop right there Max, four dollars a day is too much money!"),
        ("NEGOTIATION", "during_negotiation", "Excuse me, stop talking for a second. Make it an even three dollars.")
    ]

    agent_turn = agent_client.call_turn(session_id, "Can you hear me", reset=True)
    logger.log_turn(
        role="assistant",
        speaker="Max (AI)",
        text=agent_turn.get("textToSpeak", ""),
        stage_id="GREETING",
        latency_ms=agent_turn.get("latencyMs", 120),
        tool_calls=agent_turn.get("toolCalls", [])
    )
    print(f"🤖 Max (AI): {agent_turn.get('textToSpeak')}")

    for stage_expected, trigger_key, interrupt_text in interruption_milestones:
        print(f"\n⚡ Pre-Programmed Interruption Milestone [{stage_expected}]: \"{interrupt_text}\"")

        logger.log_turn(
            role="user",
            speaker=f"Customer ({persona['name']})",
            text=interrupt_text,
            stage_id=stage_expected,
            is_interruption=True,
            interruption_honored=True
        )
        print(f"👤 Caller [Barge-In Interruption]: {interrupt_text}")

        start_t = time.time()
        agent_turn = agent_client.call_turn(session_id, interrupt_text, reset=False)
        agent_lat = int((time.time() - start_t) * 1000)

        max_text = agent_turn.get("textToSpeak", "")
        stage_now = agent_turn.get("stageId", stage_expected)
        honored = ("listening" in max_text.lower() or "take all the time" in max_text.lower() or "understand" in max_text.lower())

        logger.log_turn(
            role="assistant",
            speaker="Max (AI)",
            text=max_text,
            stage_id=stage_now,
            intent=agent_turn.get("intent", ""),
            latency_ms=agent_lat,
            interruption_honored=honored,
            tool_calls=agent_turn.get("toolCalls", [])
        )
        print(f"🤖 Max (AI) [Honored: {honored}]: {max_text}")

    final_transcript = logger.finalize(status="completed")
    return final_transcript

def run_real_heygen_voice_test(persona_id: str = "cooperative_buyer") -> Dict[str, Any]:
    """
    Executes a real HeyGen LiveAvatar WebRTC voice session via Playwright & Edge.
    Consumes credits, measures real WebRTC streaming latency, and tests live barge-in.
    """
    cmd = f"npx tsx real_voice_runner.mjs {persona_id}"
    res = subprocess.run(cmd, shell=True, cwd=str(BASE_DIR), capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"REAL_VOICE test failed. Error:\n{res.stderr}\nOutput:\n{res.stdout}")

    out_file = BASE_DIR / "reports" / "transcripts" / "latest_real_voice.json"
    if not out_file.exists():
        raise RuntimeError(f"Real voice output file not found at {out_file}.\nOutput:\n{res.stdout}")

    with open(out_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Print session info
    print(f"✅ Real HeyGen WebRTC Session Complete! ID: {data.get('session_id')}", flush=True)
    print(f"⏱️ Duration: {data.get('duration_seconds')}s | Credits: {data.get('estimated_credits')}", flush=True)
    print(f"🔍 Inspector URL: {data.get('inspector_url')}", flush=True)

    return data


def main():
    parser = argparse.ArgumentParser(description="AI Voice Agent Testing Skill CLI")
    parser.add_argument(
        "--mode",
        choices=["text", "voice", "mock_voice", "real_voice", "all"],
        default="text",
        help="Testing mode: 'text' (0 credits), 'mock_voice' (0 credits protocol test), 'real_voice' (live HeyGen WebRTC session), or 'all'"
    )
    parser.add_argument("--real-voice", action="store_true", help="Include real HeyGen LiveAvatar WebRTC voice test in batch")
    parser.add_argument("--persona", default="all", help="Persona ID or 'all' to run in batch")
    parser.add_argument("--endpoint", default=None, help="Optional HTTP endpoint")
    parser.add_argument("--llm", action="store_true", help="Use live Grok / OpenAI API calls")
    parser.add_argument("--report", action="store_true", help="Generate or regenerate daily report from existing logs")
    args = parser.parse_args()

    simulator = CustomerSimulator()
    agent_client = AgentClient(endpoint=args.endpoint)
    judge = FlowJudge()
    fixer = PromptFixer()
    reporter = ReportGenerator()

    if args.report:
        print("Regenerating daily report from history...", flush=True)
        print(f"Reports are available at: {reporter.reports_dir}", flush=True)
        return

    all_personas = simulator.list_persona_ids()
    target_personas = [args.persona] if args.persona != "all" else all_personas

    print("================================================================================", flush=True)
    print(f"AI VOICE AGENT TESTING SKILL — EXECUTING TEST SUITE", flush=True)
    print(f"Mode: {args.mode.upper()} | Personas: {len(target_personas)} | Engine: Max DFM | Real Voice Enabled: {args.mode == 'real_voice' or args.real_voice}", flush=True)
    print("================================================================================", flush=True)

    run_results = []

    # 1. Execute Text Mode Tests
    if args.mode in ["text", "all"]:
        for p_id in target_personas:
            p_obj = simulator.get_persona(p_id)
            expected_stages = p_obj.get("expected_stages", ["GREETING", "DISCLOSURE", "QUALIFYING", "PRESENTATION_WARRANTY", "PRODUCT_OFFER", "CLOSE"])

            transcript = run_single_text_test(p_id, simulator, agent_client, use_llm=args.llm)
            evaluation = judge.evaluate_transcript(transcript, expected_stages, use_llm=args.llm)
            fix_rec = fixer.generate_fix_recommendation(evaluation, transcript.get("turns", []))

            reporter.write_csv_record(evaluation, fix_rec)
            run_results.append({
                "persona_id": p_id,
                "transcript": transcript,
                "eval": evaluation,
                "fix": fix_rec
            })
            print(f"📊 Test Score: {evaluation['overall_score']} / 100 | Status: {'PASS' if evaluation['customer_goal_completed'] else 'FAIL'}", flush=True)

    # 2. Execute Mock Voice Mode Tests (0 credits)
    if args.mode in ["voice", "mock_voice", "all"]:
        voice_personas = ["interrupting_buyer"] if args.persona == "all" else target_personas
        for vp_id in voice_personas:
            transcript = run_single_mock_voice_test(vp_id, simulator, agent_client)
            expected_stages = ["GREETING", "DISCLOSURE", "PRESENTATION_WARRANTY", "PRODUCT_OFFER", "NEGOTIATION"]
            evaluation = judge.evaluate_transcript(transcript, expected_stages, use_llm=args.llm)
            fix_rec = fixer.generate_fix_recommendation(evaluation, transcript.get("turns", []))

            reporter.write_csv_record(evaluation, fix_rec)
            run_results.append({
                "persona_id": f"{vp_id}_mock_voice",
                "transcript": transcript,
                "eval": evaluation,
                "fix": fix_rec
            })
            print(f"📊 Mock Voice Score: {evaluation['overall_score']} / 100 | Status: SIMULATED_PROTOCOL_ONLY (0 Credits)", flush=True)

    # 3. Execute Real HeyGen LiveAvatar Voice Test
    if args.mode == "real_voice" or (args.mode == "all" and args.real_voice):
        target_rv_persona = "cooperative_buyer" if args.persona == "all" else args.persona
        real_data = run_real_heygen_voice_test(target_rv_persona)
        expected_stages = [
            "GREETING", "DISCLOSURE", "QUALIFYING", "PRESENTATION_WARRANTY",
            "PRESENTATION_WEAR_TEAR", "PRODUCT_OFFER", "NEGOTIATION", "CLOSE", "VERIFICATION"
        ]

        evaluation = judge.evaluate_transcript(real_data, expected_stages, use_llm=False)
        evaluation["mode"] = real_data.get("mode", "REAL_VOICE_TWO_WAY")
        evaluation["source"] = "automated_test"
        evaluation["is_real_voice"] = True

        fix_rec = fixer.generate_fix_recommendation(evaluation, real_data.get("turns", []))
        reporter.write_csv_record(evaluation, fix_rec)

        run_results.append({
            "persona_id": f"{target_rv_persona}_real_voice",
            "transcript": real_data,
            "eval": evaluation,
            "fix": fix_rec
        })
        print(f"\n📊 REAL VOICE VALIDATION BREAKDOWN:", flush=True)
        print(f"   ├─ Scope: {evaluation.get('voice_validation_scope')}", flush=True)
        print(f"   ├─ Connection / Latency Score: {evaluation.get('latency_score')} / 100", flush=True)
        print(f"   ├─ Interruption Handling Score: {evaluation.get('interruption_score')} / 100", flush=True)
        print(f"   ├─ Full Script Compliance Score: {evaluation.get('script_compliance_score')} / 100", flush=True)
        print(f"   ├─ Verbatim Legal Disclosure Score: {evaluation.get('disclosure_verbatim_score')}%", flush=True)
        print(f"   └─ Overall Score: {evaluation['overall_score']} / 100 | Status: {'✅ PASSED (FULL_FLOW Verified)' if evaluation['voice_validation_passed'] else '❌ FAILED'}", flush=True)

    # 4. Generate Reports
    print("\n================================================================================", flush=True)
    print("GENERATING COMPLIANCE & QUALITY REPORT...", flush=True)
    print("================================================================================", flush=True)
    report_content = reporter.generate_daily_report(run_results)
    print(report_content, flush=True)
    print(f"\n✅ Reports written to:\n- {reporter.reports_dir / 'test_results.csv'}\n- {reporter.reports_dir / 'summary.html'}\n- {reporter.reports_dir / 'daily_report.md'}", flush=True)

if __name__ == "__main__":
    main()
