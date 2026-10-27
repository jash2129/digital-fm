"""
Prompt & State-Machine Fixer
Analyzes evaluation failures and recommends the smallest, most targeted
prompt or state-machine fix for human approval (no auto-applying).
"""

import os
import json
import requests
from typing import Dict, Any, Optional

class PromptFixer:
    def __init__(self):
        self.openai_key = os.getenv("OPENAI_API_KEY", "").strip()

    def generate_fix_recommendation(
        self,
        judge_report: Dict[str, Any],
        transcript_turns: list
    ) -> Dict[str, Any]:
        """
        Produce a minimal, surgical prompt or state-machine fix recommendation.
        Returns: {
            "root_cause": str,
            "target_file": str,
            "recommended_change": str,
            "diff_preview": str,
            "rationale": str
        }
        """
        root_cause = judge_report.get("root_cause", "prompt")
        failures = judge_report.get("verbatim_failures", [])
        unapproved = judge_report.get("unapproved_claims", [])
        missing_stages = judge_report.get("missing_stages", [])

        if not failures and not unapproved and not missing_stages and judge_report.get("interruption_handled", True):
            return {
                "root_cause": "none",
                "target_file": "none",
                "recommended_change": "All compliance benchmarks passed. No prompt modification required.",
                "diff_preview": "",
                "rationale": "Score meets compliance thresholds."
            }

        # 1. Try OpenAI for surgical diff recommendation
        if self.openai_key:
            rec = self._call_openai_fixer(judge_report, transcript_turns)
            if rec:
                return rec

        # 2. Rule-based minimal recommendations
        if unapproved:
            return {
                "root_cause": "prompt",
                "target_file": "src/lib/beat-controller.ts",
                "recommended_change": f"Add negative constraint in systemPrompt: 'NEVER say or promise {unapproved[0]}'",
                "diff_preview": f"- // prompt\n+ STRICT NEGATIVE CONSTRAINT: Never mention {unapproved[0]}",
                "rationale": f"Prevents unapproved claims identified in test {judge_report.get('test_id')}."
            }

        if failures:
            return {
                "root_cause": "state_machine",
                "target_file": "src/lib/beat-controller.ts",
                "recommended_change": f"Ensure {judge_report.get('stage_reached')} outputs exact approved verbatim template without paraphrase.",
                "diff_preview": "+ // Ensure exact approved script is referenced directly from approved_script.json",
                "rationale": f"Verbatim similarity fell below required threshold: {failures[0]}."
            }

        if missing_stages:
            return {
                "root_cause": "state_machine",
                "target_file": "src/lib/beat-controller.ts",
                "recommended_change": f"Prevent early progression past {missing_stages[0]} before customer acknowledgement.",
                "diff_preview": f"+ if (state.current_beat < requiredBeat) return holdCurrentBeat();",
                "rationale": f"Stage {missing_stages[0]} was skipped during consultation."
            }

        return {
            "root_cause": root_cause,
            "target_file": "src/lib/beat-controller.ts",
            "recommended_change": judge_report.get("smallest_fix", "Tune state machine transition condition"),
            "diff_preview": "+ // Minimal tuning",
            "rationale": "Generated from judge report."
        }

    def _call_openai_fixer(
        self,
        judge_report: Dict[str, Any],
        transcript_turns: list
    ) -> Optional[Dict[str, Any]]:
        prompt = f"""You are an expert AI Voice Agent Architect.
A test just failed for our Digital Finance Manager AI avatar call.

JUDGE EVALUATION:
{json.dumps(judge_report, indent=2)}

LATEST RELEVANT TURNS:
{json.dumps(transcript_turns[-6:], indent=2)}

TASK:
Recommend the SMALLEST, MOST SURGICAL prompt or state-machine change to fix this issue without side effects.
Never rewrite large blocks. Keep changes minimal (1-3 lines).

Output ONLY JSON matching:
{{
  "root_cause": "{judge_report.get('root_cause', 'prompt')}",
  "target_file": "src/lib/beat-controller.ts or src/components/liveavatar-demo.tsx",
  "recommended_change": "1-2 sentence description of the change",
  "diff_preview": "Unified diff format preview",
  "rationale": "Why this minimal change fixes the root cause"
}}"""

        try:
            res = requests.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.openai_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "gpt-4o-mini",
                    "temperature": 0.1,
                    "response_format": {"type": "json_object"},
                    "messages": [
                        {"role": "system", "content": "You are a senior software architect specializing in AI voice agents. Output valid JSON only."},
                        {"role": "user", "content": prompt}
                    ]
                },
                timeout=12
            )
            if res.ok:
                return json.loads(res.json()["choices"][0]["message"]["content"])
        except Exception:
            return None
        return None
