"""
Flow Judge
Evaluates conversation flow against approved script and business rules:
1. Tool-call sequence & timing validation (detects premature screen drags & tool calls mid-speech)
2. Spoken-number / TTS pronunciation checker
3. Concession ladder and $3.00 hard-floor enforcer (flags unauthorized drops & missing manager handoff)
4. Verification lock after Close (prevents premature identity/paperwork questions)
5. Turn-by-turn beat gating & cumulative stage requirements

Strictly outputs the exact JSON format defined in test.md.
"""

import os
import re
import json
import requests
from pathlib import Path
from typing import Dict, List, Any, Optional
from verbatim_checker import VerbatimChecker, detect_tts_pronunciation_violations

class FlowJudge:
    def __init__(self):
        self.openai_key = os.getenv("OPENAI_API_KEY", "").strip()
        self.verbatim_checker = VerbatimChecker()

    def evaluate_transcript(
        self,
        transcript_data: Dict[str, Any],
        expected_stages: List[str],
        use_llm: bool = False
    ) -> Dict[str, Any]:
        """
        Evaluate full transcript and return strict JSON format with all 5 core checks.
        """
        test_id = transcript_data.get("test_id", "test_unknown")
        mode = transcript_data.get("mode", "text")
        turns = transcript_data.get("turns", [])

        verbatim_failures: List[str] = []
        unapproved_claims: List[str] = []
        tool_timing_failures: List[str] = []
        concession_failures: List[str] = []
        verification_lock_failures: List[str] = []
        tts_pronunciation_failures: List[str] = []
        gating_failures: List[str] = []
        stages_visited: List[str] = []

        avatar_turns = [t for t in turns if t.get("role") == "assistant"]
        user_turns = [t for t in turns if t.get("role") == "user"]

        # ---------------------------------------------------------
        # Requirement 1 & 2: Clearly separate customer transcript inputs:
        # - Real customer transcript (input_type == 'REAL_CUSTOMER' or real spoken text)
        # - Missing customer input (input_type == 'MISSING' or empty text)
        # - Patched / display-only input (input_type == 'PATCHED_DISPLAY_ONLY' or 'Call Start' or '[NO_CUSTOMER_INPUT]')
        # Do not treat patched 'Call Start' userInput as a real customer response in scoring or compliance
        # ---------------------------------------------------------
        real_customer_turns = []
        missing_customer_turns = []
        patched_display_turns = []

        for ut in user_turns:
            itype = ut.get("input_type")
            text = ut.get("text", "").strip()
            if itype == "PATCHED_DISPLAY_ONLY" or text in ["Call Start", "[NO_CUSTOMER_INPUT]"]:
                patched_display_turns.append(ut)
            elif itype == "MISSING" or not text:
                missing_customer_turns.append(ut)
            else:
                real_customer_turns.append(ut)

        # ---------------------------------------------------------
        # Check 0: Script Integrity (approved_script.json vs client requirements)
        # ---------------------------------------------------------
        script_errors = self.verbatim_checker.validate_script_integrity()
        if script_errors:
            for se in script_errors:
                unapproved_claims.append(f"Script Integrity Error: {se}")

        # ---------------------------------------------------------
        # Check 1: Tool-Call Sequence & Timing Validation
        # ---------------------------------------------------------
        for i, t in enumerate(turns):
            if t.get("role") == "assistant":
                stage_id = t.get("stage_id", "")
                tool_calls = t.get("tool_calls", [])
                text_spoken = t.get("text", "")

                # Check if previous turn was a real user interruption and tool fired immediately
                if i > 0 and turns[i - 1].get("role") == "user" and turns[i - 1].get("is_interruption"):
                    if tool_calls:
                        tool_names = [tc.get("name") for tc in tool_calls]
                        tool_timing_failures.append(
                            f"Turn {t.get('turn_id')}: Tool [{', '.join(tool_names)}] dispatched during user barge-in interruption."
                        )

                for tc in tool_calls:
                    tc_name = tc.get("name")
                    tc_args = tc.get("args", {})

                    # Premature screen drag in early stages
                    if stage_id in ["GREETING", "DISCLOSURE", "QUALIFYING"]:
                        if tc_name in ["show_content", "draw_grid_outline", "show_pricing", "show_payment_breakdown"]:
                            tool_timing_failures.append(
                                f"Premature Screen Drag (Turn {t.get('turn_id')}, Stage {stage_id}): Tool '{tc_name}' fired before Square 1-2 Hook."
                            )

                    # Check show_payment_breakdown rate matches spoken price
                    if tc_name == "show_payment_breakdown":
                        rate = tc_args.get("daily_rate")
                        if rate is not None:
                            if rate not in [4, 4.0, 3.5, 3.25, 3, 3.0]:
                                tool_timing_failures.append(
                                    f"Turn {t.get('turn_id')}: show_payment_breakdown passed unapproved daily_rate '{rate}'. Must be one of [4.0, 3.5, 3.25, 3.0]."
                                )

        # ---------------------------------------------------------
        # Check 2: Spoken-Number / TTS Pronunciation Validation
        # ---------------------------------------------------------
        for t in avatar_turns:
            text = t.get("text", "")
            tts_viols = detect_tts_pronunciation_violations(text)
            if tts_viols:
                for tv in tts_viols:
                    tts_pronunciation_failures.append(
                        f"Turn {t.get('turn_id')} [{t.get('stage_id')}]: {tv['message']}"
                    )

        # ---------------------------------------------------------
        # Check 3: Concession Ladder & $3.00 Hard Floor Enforcer
        # ---------------------------------------------------------
        quoted_rates: List[float] = []
        hard_floor_breached = False

        for t in avatar_turns:
            text = t.get("text", "")
            lower_text = text.lower()

            if any(p in lower_text for p in ["cut the vehicle price", "discount the car", "zero percent interest", "drop the car price"]):
                unapproved_claims.append(f"Turn {t.get('turn_id')}: Prohibited alteration of vehicle sale price or loan APR.")

            if "four dollars" in lower_text or "$4.00" in lower_text or "$4 " in lower_text or "$4/day" in lower_text:
                quoted_rates.append(4.0)
            if "three dollars and fifty cents" in lower_text or "$3.50" in lower_text or "$3.5 " in lower_text:
                quoted_rates.append(3.50)
            if "three dollars and twenty-five cents" in lower_text or "$3.25" in lower_text:
                quoted_rates.append(3.25)
            if "three dollars" in lower_text and "fifty" not in lower_text and "twenty" not in lower_text:
                quoted_rates.append(3.00)
            if "two dollars" in lower_text or "$2.50" in lower_text or "$2.00" in lower_text or "$2 " in lower_text or "one dollar" in lower_text or "$1.00" in lower_text:
                hard_floor_breached = True
                quoted_rates.append(2.00)

            for tc in t.get("tool_calls", []):
                if tc.get("name") == "show_payment_breakdown":
                    rate = float(tc.get("args", {}).get("daily_rate", 4.0))
                    quoted_rates.append(rate)
                    if rate < 3.0:
                        hard_floor_breached = True

        if hard_floor_breached:
            concession_failures.append(
                "CRITICAL_SAFETY_VIOLATION: Quoted daily rate below $3.00 hard floor! Automatic failure."
            )

        distinct_rates = []
        for r in quoted_rates:
            if not distinct_rates or distinct_rates[-1] != r:
                distinct_rates.append(r)

        if len(distinct_rates) > 1:
            for idx in range(len(distinct_rates) - 1):
                cur_r, next_r = distinct_rates[idx], distinct_rates[idx + 1]
                if cur_r == 4.0 and next_r == 3.0:
                    concession_failures.append(
                        f"Concession ladder skipped: dropped directly from $4.00 to $3.00 without presenting $3.50 and $3.25."
                    )
                elif cur_r == 4.0 and next_r == 3.25:
                    concession_failures.append(
                        f"Concession ladder skipped: dropped from $4.00 to $3.25 without presenting $3.50."
                    )

        # Enforce manager handoff if real customer pushed below $3.00 (excluding patched entries)
        user_pushed_below_floor = any(
            re.search(r"\b(2(\.50)?|two|under 3|less than 3|below 3|lower than 3)\b", ut.get("text", "").lower())
            for ut in real_customer_turns
        )
        if user_pushed_below_floor:
            handoff_spoken = any(
                ("colleague" in t.get("text", "").lower() or "team member" in t.get("text", "").lower())
                for t in avatar_turns
            )
            escalate_tool = any(
                any(tc.get("name") in ["escalate_to_human", "show_content"] and tc.get("args", {}).get("item") == "escalate" for tc in t.get("tool_calls", []))
                for t in avatar_turns
            )
            if not (handoff_spoken or escalate_tool):
                concession_failures.append(
                    "Manager Handoff Missing: Customer pushed below $3 floor but Max did not escalate to human manager."
                )

        # ---------------------------------------------------------
        # Check 4: Verification Lock After Close
        # ---------------------------------------------------------
        close_reached = False
        verification_pattern = re.compile(r"(verify your (full legal )?name|mailing address|spelling of your name|driver's license)", re.IGNORECASE)

        for t in avatar_turns:
            stg = t.get("stage_id", "")
            txt = t.get("text", "")
            if stg == "CLOSE" or "moving forward with full vehicle protection" in txt.lower():
                close_reached = True

            if verification_pattern.search(txt):
                if not close_reached and stg != "VERIFICATION":
                    verification_lock_failures.append(
                        f"PROTOCOL_VIOLATION (Turn {t.get('turn_id')}): Premature identity/address verification requested before verbal close completion."
                    )

        # ---------------------------------------------------------
        # Check 5: Turn-by-Turn Beat Gating & Cumulative Stage Requirements
        # ---------------------------------------------------------
        qualifying_turns = [t for t in avatar_turns if t.get("stage_id") == "QUALIFYING"]
        if qualifying_turns:
            q_texts = [t.get("text", "") for t in qualifying_turns]
            has_q1 = any("drive the vehicle" in q.lower() or "chance to drive" in q.lower() for q in q_texts)
            has_q2 = any("walkaround" in q.lower() or "bells, and whistles" in q.lower() or "features" in q.lower() for q in q_texts)
            has_q3 = any("understanding of the warranty" in q.lower() or "warranty that comes" in q.lower() for q in q_texts)

            if len(qualifying_turns) < 3 and not (has_q1 and has_q2 and has_q3):
                gating_failures.append(
                    f"Qualifying Stage Gating: Expected 3 distinct turns for Q1 (drive), Q2 (walkaround), Q3 (warranty). Found {len(qualifying_turns)} turns."
                )

        # Aggregate avatar text by stage for cumulative compliance
        stage_texts: Dict[str, List[str]] = {}
        for t in avatar_turns:
            stage_id = t.get("stage_id", "")
            if stage_id:
                stage_texts.setdefault(stage_id, []).append(t.get("text", ""))

        for stage_id, texts in stage_texts.items():
            if stage_id not in stages_visited:
                stages_visited.append(stage_id)

            combined_stage_text = " ".join(texts)
            check = self.verbatim_checker.check_stage_compliance(stage_id, combined_stage_text)
            if not check.get("passed", True):
                for f in check.get("failures", []):
                    verbatim_failures.append(f"[{stage_id}] {f}")
            if check.get("detected_forbidden_phrases"):
                for fp in check["detected_forbidden_phrases"]:
                    unapproved_claims.append(f"Spoke forbidden phrase: '{fp}'")

        # Missing expected stages
        missing_stages = [s for s in expected_stages if s not in stages_visited]

        # Stage order
        stage_order_correct = True
        for i in range(len(stages_visited) - 1):
            valid, _ = self.verbatim_checker.validate_stage_transition(
                stages_visited[i], stages_visited[i + 1]
            )
            if not valid:
                stage_order_correct = False
                break

        # Check interruptions (only real customer turns)
        interruption_turns = [t for t in real_customer_turns if t.get("is_interruption")]
        interruption_handled = True
        if interruption_turns:
            for it in interruption_turns:
                idx = turns.index(it)
                if idx + 1 < len(turns):
                    if it.get("interruption_honored") is False:
                        interruption_handled = False

        # Latency check (>2500ms flagged)
        latency_issues = []
        for t in avatar_turns:
            lat = t.get("latency_ms", 0)
            if lat > 2500:
                latency_issues.append(f"Turn {t.get('turn_id')}: {lat}ms exceeds threshold")

        # ---------------------------------------------------------
        # Mandatory Stages Definition (Requirement 3 & 5)
        # ---------------------------------------------------------
        MANDATORY_STAGES = [
            "GREETING", "DISCLOSURE", "QUALIFYING", "PRESENTATION_WARRANTY",
            "PRESENTATION_WEAR_TEAR", "PRODUCT_OFFER", "NEGOTIATION", "CLOSE", "VERIFICATION"
        ]
        missing_mandatory = [s for s in MANDATORY_STAGES if s not in stages_visited]

        is_mock_voice = (mode.upper() in ["MOCK_VOICE", "VOICE"])
        is_real_voice = (mode.upper() in ["REAL_VOICE", "REAL_VOICE_TWO_WAY"])

        # ---------------------------------------------------------
        # Requirement 6: voice_validation_scope calculation
        # CONNECTION_ONLY, PARTIAL_FLOW, or FULL_FLOW
        # ---------------------------------------------------------
        if is_real_voice:
            if len(stages_visited) <= 1 and ("GREETING" in stages_visited or len(avatar_turns) <= 1):
                voice_validation_scope = "CONNECTION_ONLY"
            elif len(missing_mandatory) == 0:
                voice_validation_scope = "FULL_FLOW"
            else:
                voice_validation_scope = "PARTIAL_FLOW"
        else:
            if all(s in stages_visited for s in expected_stages):
                voice_validation_scope = "FULL_FLOW"
            else:
                voice_validation_scope = "PARTIAL_FLOW"

        # ---------------------------------------------------------
        # Requirement 4: Separate Sub-Scores Calculation
        # 1. Connection / Latency
        # 2. Interruption Handling
        # 3. Full Script Compliance
        # 4. Verbatim Disclosure Compliance
        # ---------------------------------------------------------
        # 1. Connection/Latency Score (0-100)
        latency_deductions = 0
        if not avatar_turns:
            latency_score = 0
        else:
            for t in avatar_turns:
                lat = t.get("latency_ms", 0)
                if lat > 2500:
                    latency_deductions += 15
                elif lat > 1500:
                    latency_deductions += 5
            latency_score = max(0, min(100, 100 - latency_deductions))

        # 2. Interruption Handling Score (0-100)
        if interruption_turns:
            unhonored = [it for it in interruption_turns if it.get("interruption_honored") is False]
            interruption_score = max(0, min(100, 100 - (len(unhonored) * 50)))
        else:
            interruption_score = 100

        # 3. Verbatim Disclosure Compliance Score (0-100)
        disclosure_texts = stage_texts.get("DISCLOSURE", [])
        combined_disclosure = " ".join(disclosure_texts)
        if combined_disclosure:
            expected_disclosure = "Before I start I just want to let you know this transaction is recorded audio and video, also I'm required by the law to go over everything with you before you sign any paperwork to make sure you understand first okay."
            passed_disc, disc_ratio, _ = self.verbatim_checker.check_verbatim_line(
                combined_disclosure, expected_disclosure, threshold=0.99
            )
            disclosure_verbatim_score = round(disc_ratio * 100.0, 1)
        else:
            disclosure_verbatim_score = 0.0

        # 4. Full Script Compliance Score (0-100)
        if hard_floor_breached:
            script_compliance_score = 0
        else:
            sc_score = 100
            sc_score -= len(missing_stages) * 12
            sc_score -= len(verbatim_failures) * 10
            sc_score -= len(unapproved_claims) * 25
            sc_score -= len(tool_timing_failures) * 15
            sc_score -= len(concession_failures) * 20
            sc_score -= len(verification_lock_failures) * 20
            sc_score -= len(tts_pronunciation_failures) * 5
            sc_score -= len(gating_failures) * 10
            if not stage_order_correct:
                sc_score -= 15
            script_compliance_score = max(0, min(100, sc_score))

        # Composite overall score
        if hard_floor_breached:
            overall_score = 0
        else:
            weighted_score = (
                0.35 * script_compliance_score +
                0.25 * disclosure_verbatim_score +
                0.20 * latency_score +
                0.20 * interruption_score
            )
            overall_score = int(round(weighted_score))
            if missing_stages:
                overall_score = min(overall_score, 100 - (len(missing_stages) * 10))
            if unapproved_claims:
                overall_score = min(overall_score, 70)

        # ---------------------------------------------------------
        # Requirement 5: Do not show 100/100 unless ALL mandatory stages
        # and verbatim checks pass in the real voice session.
        # ---------------------------------------------------------
        if is_real_voice:
            has_mandatory_deficit = (
                len(missing_mandatory) > 0
                or voice_validation_scope != "FULL_FLOW"
                or disclosure_verbatim_score < 99.0
                or len(verbatim_failures) > 0
                or len(unapproved_claims) > 0
                or len(tts_pronunciation_failures) > 0
                or len(tool_timing_failures) > 0
                or len(concession_failures) > 0
                or len(verification_lock_failures) > 0
                or not stage_order_correct
                or hard_floor_breached
                or not interruption_handled
            )
            if has_mandatory_deficit and overall_score >= 100:
                overall_score = 95

        overall_score = max(0, min(100, overall_score))

        # Root Cause determination
        root_cause = "none"
        if hard_floor_breached or concession_failures or verification_lock_failures:
            root_cause = "state_machine"
        elif tool_timing_failures:
            root_cause = "tool"
        elif tts_pronunciation_failures or verbatim_failures or unapproved_claims:
            root_cause = "prompt"
        elif latency_issues:
            root_cause = "latency"
        elif not interruption_handled:
            root_cause = "avatar"
        elif not stage_order_correct or missing_stages or gating_failures:
            root_cause = "state_machine"

        smallest_fix = ""
        if hard_floor_breached:
            smallest_fix = "Enforce programmatic hard floor: abort price concessions at $3.00/day and invoke escalate_to_human."
        elif tool_timing_failures:
            smallest_fix = f"Gating fix: Prevent tool dispatch before Square 1-2 Hook or during user interruption ({tool_timing_failures[0]})."
        elif verification_lock_failures:
            smallest_fix = "Enforce verification_locked = true until Stage 7 verbal close is formally completed."
        elif tts_pronunciation_failures:
            smallest_fix = f"Format speech text: Replace raw digits with spelled-out words ({tts_pronunciation_failures[0]})."
        elif concession_failures:
            smallest_fix = f"Enforce monotonic concession ladder: {concession_failures[0]}"
        elif gating_failures:
            smallest_fix = "Split qualifying questions into 3 distinct conversational turns."
        elif verbatim_failures:
            smallest_fix = f"Update dialogue template to match verbatim script: {verbatim_failures[0]}"
        elif unapproved_claims:
            smallest_fix = f"Add negative prompt constraint prohibiting: {unapproved_claims[0]}"

        # Voice validation policy
        voice_validation_passed = False
        if is_real_voice:
            voice_validation_passed = (
                overall_score >= 75
                and voice_validation_scope == "FULL_FLOW"
                and not hard_floor_breached
                and len(unapproved_claims) == 0
                and interruption_handled
            )
        elif is_mock_voice:
            voice_validation_passed = False
            unapproved_claims.append(
                "MOCK_VOICE_NOTICE: Simulated protocol test did not create a real HeyGen LiveAvatar WebRTC session or consume credits. Real voice validation requires mode REAL_VOICE."
            )

        goal_completed = overall_score >= 75 and not hard_floor_breached and len(unapproved_claims) == 0 and (not is_mock_voice)

        all_verbatim = verbatim_failures + [f"[TTS] {t}" for t in tts_pronunciation_failures]
        all_unapproved = unapproved_claims + [f"[Concession] {c}" for c in concession_failures] + [f"[Lock] {l}" for l in verification_lock_failures] + [f"[Tool Timing] {tt}" for tt in tool_timing_failures] + [f"[Gating] {g}" for g in gating_failures]
        last_stage = stages_visited[-1] if stages_visited else "NONE"

        return {
            "test_id": test_id,
            "mode": "MOCK_VOICE" if is_mock_voice else ("REAL_VOICE" if is_real_voice else mode),
            "is_real_voice": is_real_voice,
            "voice_validation_scope": voice_validation_scope,
            "voice_validation_passed": voice_validation_passed,
            "stage_reached": last_stage,
            "stage_order_correct": stage_order_correct,
            "stages_visited": stages_visited,
            "missing_stages": missing_stages,
            "missing_mandatory_stages": missing_mandatory,
            "verbatim_failures": all_verbatim,
            "unapproved_claims": all_unapproved,
            "hallucinations": [],
            "interruption_handled": interruption_handled,
            "latency_issues": latency_issues,
            "customer_goal_completed": goal_completed,
            "scores": {
                "latency_score": latency_score,
                "interruption_score": interruption_score,
                "script_compliance_score": script_compliance_score,
                "disclosure_verbatim_score": disclosure_verbatim_score,
                "overall_score": overall_score
            },
            "latency_score": latency_score,
            "interruption_score": interruption_score,
            "script_compliance_score": script_compliance_score,
            "disclosure_verbatim_score": disclosure_verbatim_score,
            "overall_score": overall_score,
            "transcript_breakdown": {
                "real_customer_count": len(real_customer_turns),
                "missing_customer_count": len(missing_customer_turns),
                "patched_display_count": len(patched_display_turns),
                "real_customer_texts": [t.get("text", "") for t in real_customer_turns],
                "missing_customer_ids": [t.get("turn_id") for t in missing_customer_turns],
                "patched_display_texts": [t.get("text", "") for t in patched_display_turns]
            },
            "root_cause": root_cause,
            "smallest_fix": smallest_fix
        }
