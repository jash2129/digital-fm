"""
Verbatim & Script Compliance Checker
Uses exact normalized matching and RapidFuzz fuzzy similarity scoring
against approved_script.json.
Enforces:
1. Strict 99% verbatim threshold on legal disclosure
2. TTS Spoken-Number / Pronunciation validation (catches raw digits like $4.00, 36,000)
3. Client-approved warranty & pricing values from wordtoword.md
"""

import json
import re
from pathlib import Path
from typing import Dict, List, Any, Tuple
from rapidfuzz import fuzz

SCRIPT_PATH = Path(__file__).parent / "approved_script.json"

def normalize_text(text: str) -> str:
    """Normalize text for consistent comparison (lowercase, single spaces, strip punctuation)."""
    if not text:
        return ""
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text

def detect_tts_pronunciation_violations(spoken_text: str) -> List[Dict[str, Any]]:
    """
    Detects raw numeric digits and abbreviations that HeyGen TTS reads incorrectly.
    HeyGen TTS reads raw digits like '60,000' as 'six zero zero zero zero' or '$4.00' as 'four point zero zero'.
    All numbers, prices, percentages, and terms must be spelled out in words.
    
    Allowable exception: The vehicle model year '2026' in '2026 Mazda CX-5'.
    """
    if not spoken_text:
        return []

    violations = []

    # 1. Currency with dollar sign (e.g. $4.00, $4, $7,000, $3.50)
    dollar_matches = re.finditer(r"\$\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)", spoken_text)
    for m in dollar_matches:
        raw_val = m.group(0)
        violations.append({
            "violation_type": "tts_raw_currency",
            "found": raw_val,
            "message": f"Raw currency digit '{raw_val}' breaks HeyGen TTS. Must use spoken words (e.g., 'four dollars', 'seven thousand dollars')."
        })

    # 2. Percent sign with digits (e.g. 95%, 100%)
    pct_matches = re.finditer(r"\b([0-9]+)\s*%", spoken_text)
    for m in pct_matches:
        raw_val = m.group(0)
        violations.append({
            "violation_type": "tts_raw_percentage",
            "found": raw_val,
            "message": f"Raw percentage '{raw_val}' breaks HeyGen TTS. Must use spoken words (e.g., 'ninety-five percent', 'one hundred percent')."
        })

    # 3. Rate abbreviations (e.g. /day, /mo, /month, /hr, /hour)
    rate_matches = re.finditer(r"(/[a-zA-Z]+)", spoken_text)
    for m in rate_matches:
        raw_val = m.group(0)
        violations.append({
            "violation_type": "tts_rate_abbreviation",
            "found": raw_val,
            "message": f"Abbreviation '{raw_val}' breaks HeyGen TTS. Must spell out (e.g., 'a day', 'per month', 'an hour')."
        })

    # 4. Comma-formatted numbers (e.g. 36,000, 60,000, 100,000, 7,000)
    comma_num_matches = re.finditer(r"\b\d{1,3}(?:,\d{3})+\b", spoken_text)
    for m in comma_num_matches:
        raw_val = m.group(0)
        violations.append({
            "violation_type": "tts_comma_number",
            "found": raw_val,
            "message": f"Comma-separated number '{raw_val}' read digit-by-digit by TTS. Must write out in words (e.g., 'thirty-six thousand', 'sixty thousand')."
        })

    # 5. Hyphenated number ranges (e.g. 10-15, 3-5, 3-yr)
    range_matches = re.finditer(r"\b\d+\s*-\s*(?:\d+|yr|year)\b", spoken_text, re.IGNORECASE)
    for m in range_matches:
        raw_val = m.group(0)
        violations.append({
            "violation_type": "tts_hyphenated_range",
            "found": raw_val,
            "message": f"Hyphenated range '{raw_val}' breaks TTS prosody. Must spell out (e.g., 'ten to fifteen hours', 'three years')."
        })

    # 6. Standalone digits (0-9999 except approved vehicle model year 2026 and CX-5)
    masked_text = re.sub(r"\b2026\b", "____", spoken_text)
    masked_text = re.sub(r"\bcx-5\b", "cx-five", masked_text, flags=re.IGNORECASE)
    masked_text = re.sub(r"\bcx5\b", "cx-five", masked_text, flags=re.IGNORECASE)
    standalone_matches = re.finditer(r"\b\d+\b", masked_text)
    for m in standalone_matches:
        raw_val = m.group(0)
        # Avoid duplicate flagging if already flagged in comma/currency
        if not any(raw_val in v["found"] for v in violations):
            violations.append({
                "violation_type": "tts_standalone_digit",
                "found": raw_val,
                "message": f"Raw standalone digit '{raw_val}' read as digit sequence by TTS. Must spell out as words (e.g., 'three', 'four', 'seven')."
            })

    return violations

class VerbatimChecker:
    def __init__(self, script_path: Path = SCRIPT_PATH):
        with open(script_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        self.metadata = data.get("script_metadata", {})
        self.stages = {stage["stage_id"]: stage for stage in data.get("stages", [])}

    def validate_script_integrity(self) -> List[str]:
        """Validates that approved_script.json matches wordtoword.md specifications."""
        errors = []
        warranty = self.metadata.get("warranty_terms", {})
        if "five years sixty thousand mile" not in warranty.get("base", ""):
            errors.append("Script mismatch: Base warranty must be 'five years sixty thousand mile Base limited warranty'.")
        if "ten years hundred thousand mile" not in warranty.get("powertrain", ""):
            errors.append("Script mismatch: Powertrain warranty must be 'ten years hundred thousand mile powertrain'.")
        if "ten years hundred thousand mile" not in warranty.get("wrap", ""):
            errors.append("Script mismatch: Wrap warranty must be 'ten years hundred thousand mile warranty BUMPER TO BUMPER'.")

        pricing = self.metadata.get("pricing", {})
        if pricing.get("hard_floor_daily") != 3.0:
            errors.append("Script mismatch: Hard floor daily rate must be exactly 3.0.")
        if pricing.get("anchor_daily") != 4.0:
            errors.append("Script mismatch: Opening quote daily rate must be exactly 4.0.")

        return errors

    def check_verbatim_line(
        self, spoken: str, expected: str, threshold: float = 0.90
    ) -> Tuple[bool, float, str]:
        """
        Check if spoken text matches an expected verbatim line.
        Returns: (passes: bool, score: float, match_type: str)
        """
        norm_spoken = normalize_text(spoken)
        norm_expected = normalize_text(expected)

        if not norm_spoken or not norm_expected:
            return False, 0.0, "empty"

        # 1. Exact match
        if norm_spoken == norm_expected:
            return True, 1.0, "exact"

        # 2. Substring match
        if norm_expected in norm_spoken:
            return True, 1.0, "exact_substring"

        # 3. RapidFuzz Token Sort & Ratio
        ratio_score = fuzz.ratio(norm_spoken, norm_expected) / 100.0
        token_sort_score = fuzz.token_sort_ratio(norm_spoken, norm_expected) / 100.0
        partial_ratio = fuzz.partial_ratio(norm_expected, norm_spoken) / 100.0

        best_score = max(ratio_score, token_sort_score, partial_ratio)
        passes = best_score >= threshold
        return passes, round(best_score, 4), "rapidfuzz"

    def check_stage_compliance(
        self, stage_id: str, spoken_text: str
    ) -> Dict[str, Any]:
        """
        Validates spoken text against stage requirements:
        - Mandatory lines (RapidFuzz / exact)
        - Required phrases
        - Forbidden phrases
        - TTS spoken-number pronunciation violations
        """
        stage = self.stages.get(stage_id)
        if not stage:
            return {
                "stage_id": stage_id,
                "valid_stage": False,
                "error": f"Unknown stage: {stage_id}"
            }

        norm_spoken = normalize_text(spoken_text)
        threshold = stage.get("similarity_threshold", 0.90)

        # 1. Check mandatory verbatim lines
        mandatory_results = []
        for line in stage.get("mandatory_verbatim_lines", []):
            passes, score, match_type = self.check_verbatim_line(
                spoken_text, line, threshold=threshold
            )
            mandatory_results.append({
                "expected": line,
                "passes": passes,
                "score": score,
                "match_type": match_type
            })

        verbatim_passed = any(r["passes"] for r in mandatory_results) if mandatory_results else True

        # 2. Check required phrases
        missing_phrases = []
        for phrase in stage.get("required_phrases", []):
            norm_phrase = normalize_text(phrase)
            if norm_phrase not in norm_spoken and fuzz.partial_ratio(norm_phrase, norm_spoken) < 85:
                missing_phrases.append(phrase)

        # 3. Check forbidden phrases
        detected_forbidden = []
        for phrase in stage.get("forbidden_phrases", []):
            norm_phrase = normalize_text(phrase)
            if norm_phrase in norm_spoken or fuzz.partial_ratio(norm_phrase, norm_spoken) > 92:
                detected_forbidden.append(phrase)

        # 4. Check TTS Spoken-Number violations
        tts_violations = detect_tts_pronunciation_violations(spoken_text)

        # Overall stage score calculation
        score = 100
        failures = []

        if stage_id == "DISCLOSURE":
            # Strict 99% threshold for disclosure
            disclosure_scores = [r["score"] for r in mandatory_results]
            highest_score = max(disclosure_scores, default=0.0)
            if highest_score < 0.99:
                score -= 40
                failures.append(f"Disclosure similarity {highest_score:.4f} is below strict 99% threshold")

        if missing_phrases:
            penalty = min(35, len(missing_phrases) * 8)
            score -= penalty
            failures.append(f"Missing required phrases: {', '.join(missing_phrases)}")

        if detected_forbidden:
            score -= 50
            failures.append(f"Spoke forbidden unapproved claims: {', '.join(detected_forbidden)}")

        if tts_violations:
            tts_penalty = min(25, len(tts_violations) * 5)
            score -= tts_penalty
            sample_violations = [v["found"] for v in tts_violations[:3]]
            failures.append(f"TTS pronunciation violations ({len(tts_violations)} detected: {', '.join(sample_violations)})")

        score = max(0, score)

        return {
            "stage_id": stage_id,
            "title": stage.get("title"),
            "verbatim_passed": verbatim_passed,
            "mandatory_results": mandatory_results,
            "missing_required_phrases": missing_phrases,
            "detected_forbidden_phrases": detected_forbidden,
            "tts_violations": tts_violations,
            "stage_score": score,
            "passed": score >= 75 and len(detected_forbidden) == 0,
            "failures": failures
        }

    def validate_stage_transition(
        self, current_stage: str, next_stage: str
    ) -> Tuple[bool, str]:
        """Verify whether moving from current_stage to next_stage is permitted."""
        if not current_stage or current_stage == next_stage:
            return True, "valid_same_or_initial"

        stage = self.stages.get(current_stage)
        if not stage:
            return False, f"Unknown current stage {current_stage}"

        allowed = stage.get("allowed_next_stages", [])
        if next_stage in allowed:
            return True, f"Valid transition to {next_stage}"

        return False, f"Illegal stage skip: {current_stage} -> {next_stage}. Allowed: {allowed}"
