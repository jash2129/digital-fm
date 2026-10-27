"""
Customer Simulator
Simulates diverse adversarial buyer personas using Grok API (xAI) or OpenAI
with deterministic offline fallbacks.
"""

import os
import json
import requests
from pathlib import Path
from typing import Dict, List, Any, Optional

PERSONAS_PATH = Path(__file__).parent / "personas.json"

class CustomerSimulator:
    def __init__(self, personas_path: Path = PERSONAS_PATH):
        with open(personas_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        self.personas = {p["id"]: p for p in data.get("personas", [])}

        self.xai_key = os.getenv("XAI_API_KEY", "").strip()
        self.openai_key = os.getenv("OPENAI_API_KEY", "").strip()
        self.grok_model = os.getenv("GROK_MODEL", "grok-4.20-0309-non-reasoning").strip()

    def get_persona(self, persona_id: str) -> Optional[Dict[str, Any]]:
        return self.personas.get(persona_id)

    def list_persona_ids(self) -> List[str]:
        return list(self.personas.keys())

    def generate_reply(
        self,
        persona_id: str,
        dialogue_history: List[Dict[str, str]],
        current_stage: str = "",
        interruption_requested: bool = False,
        use_llm: bool = True
    ) -> Dict[str, Any]:
        """
        Generate customer reply given persona and dialogue history.
        Returns: {
            "text": str,
            "is_interruption": bool,
            "persona_id": str,
            "generator": "xai" | "openai" | "rule_fallback"
        }
        """
        persona = self.get_persona(persona_id)
        if not persona:
            raise ValueError(f"Unknown persona ID: {persona_id}")

        # Fast rule fallback if LLM is disabled
        if not use_llm:
            fallback_text = self._rule_based_reply(persona_id, dialogue_history, current_stage)
            return {
                "text": fallback_text,
                "is_interruption": False,
                "persona_id": persona_id,
                "generator": "rule_fallback"
            }

        # If interruption requested at this milestone, return sharp barge-in phrase
        if interruption_requested:
            barge_in_phrases = {
                "during_disclosure": "Wait, hold on a second! Why are you recording me, who is this?",
                "during_warranty": "Let me tell you something! The salesperson already told me everything is covered!",
                "during_offer": "Stop right there Max, four dollars a day is way too expensive for me.",
                "during_negotiation": "Excuse me, stop talking for a second. Make it an even three dollars or I walk."
            }
            phrase = barge_in_phrases.get(persona.get("interruption_trigger", ""), "Wait, hold on! Let me tell you something.")
            return {
                "text": phrase,
                "is_interruption": True,
                "persona_id": persona_id,
                "generator": "preset_barge_in"
            }

        # 1. Try xAI Grok API (only if use_llm is explicitly enabled)
        if use_llm and self.xai_key:
            reply = self._call_llm(
                endpoint="https://api.x.ai/v1/chat/completions",
                api_key=self.xai_key,
                model=self.grok_model,
                persona=persona,
                dialogue_history=dialogue_history,
                current_stage=current_stage
            )
            if reply:
                return {
                    "text": reply,
                    "is_interruption": False,
                    "persona_id": persona_id,
                    "generator": "xai_grok"
                }

        # 2. Try OpenAI API (only if use_llm is explicitly enabled)
        if use_llm and self.openai_key:
            reply = self._call_llm(
                endpoint="https://api.openai.com/v1/chat/completions",
                api_key=self.openai_key,
                model="gpt-4o-mini",
                persona=persona,
                dialogue_history=dialogue_history,
                current_stage=current_stage
            )
            if reply:
                return {
                    "text": reply,
                    "is_interruption": False,
                    "persona_id": persona_id,
                    "generator": "openai"
                }

        # 3. Rule-based persona fallback
        fallback_text = self._rule_based_reply(persona_id, dialogue_history, current_stage)
        return {
            "text": fallback_text,
            "is_interruption": False,
            "persona_id": persona_id,
            "generator": "rule_fallback"
        }

    def _call_llm(
        self,
        endpoint: str,
        api_key: str,
        model: str,
        persona: Dict[str, Any],
        dialogue_history: List[Dict[str, str]],
        current_stage: str
    ) -> Optional[str]:
        system_prompt = (
            f"{persona['system_prompt']}\n\n"
            f"You are on a video call with Max, the Digital Finance Manager.\n"
            f"Current call stage: {current_stage or 'GENERAL'}\n"
            f"Dialogue style: {persona['dialogue_style']}\n"
            f"RULES:\n"
            f"- Reply as the customer in exactly ONE natural, conversational sentence (maximum 20 words).\n"
            f"- Stay in character. Do not output markdown, bullet points, or quotes.\n"
            f"- Sound authentic and spontaneous."
        )

        messages = [{"role": "system", "content": system_prompt}]
        for turn in dialogue_history[-6:]:
            role = "assistant" if turn["role"] == "assistant" else "user"
            messages.append({"role": role, "content": turn["content"]})

        try:
            res = requests.post(
                endpoint,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": model,
                    "temperature": 0.3,
                    "max_tokens": 50,
                    "messages": messages
                },
                timeout=10
            )
            if res.ok:
                data = res.json()
                content = data["choices"][0]["message"]["content"].strip()
                content = content.replace('"', "").replace("'", "")
                return content
        except Exception:
            return None
        return None

    def _rule_based_reply(
        self, persona_id: str, history: List[Dict[str, str]], stage: str
    ) -> str:
        last_turn = history[-1]["content"].lower() if history else ""

        if persona_id == "rude_adversarial_buyer":
            if "verify your" in last_turn or "legal name" in last_turn or "mailing address" in last_turn:
                return "Marcus Vance, spelled M-A-R-C-U-S, V-A-N-C-E, 410 North Oak Street, Austin Texas."
            if "to confirm" in last_turn or "moving forward" in last_turn or "finalize" in last_turn:
                return "Yes, I confirm. Full protection at three dollars a day. Let's finish the paperwork."
            if "three dollars" in last_turn:
                return "Alright, at three dollars a day you've got a deal. Let's do it."
            if "value in" in last_turn or "three dollars and fifty" in last_turn:
                return "I see value in the warranty, but not at four dollars. Can you do three dollars a day?"
            if "four dollars a day" in last_turn or "coffee a day" in last_turn:
                return "Stop right there Max! Four dollars a day adds up to thousands over my loan. That is way too expensive, no deal!"
            if "experience" in last_turn or "connect with you" in last_turn:
                return "Honestly, I've been waiting for three hours. Who are you, and can we hurry this up?"
            if "recorded" in last_turn or "first okay" in last_turn:
                return "Hold on a second! Why are you recording me? Are you an AI or a real person?"
            if "digital finance manager" in last_turn or "right here with you" in last_turn or "ai finance assistant" in last_turn:
                return "Fine, whatever. Just don't waste my time with extra sales pitches."
            if "chance to drive" in last_turn:
                return "Yeah, I drove it. It's a brand new Mazda, it drives fine."
            if "walkaround" in last_turn or "bells, and whistles" in last_turn:
                return "He showed me the features, but what about my loan? Did finance approve my zero percent interest rate?"
            if "warranty" in last_turn and ("understanding" in last_turn or "sales person" in last_turn):
                return "The salesman said it has full factory warranty. Japanese cars don't break down, why would I buy anything extra?"
            if "more information about the warranty" in last_turn:
                return "Make it brief. I have an appointment to get to."
            return "Fine, make it quick."

        if persona_id == "cooperative_buyer":
            if "hear and see" in last_turn:
                return "Yeah, I can see and hear you perfectly."
            if "experience" in last_turn:
                return "Yes, it was great, the sales team was very helpful."
            if "recorded" in last_turn or "first okay" in last_turn:
                return "Yes, that is completely fine with me."
            if "chance to drive" in last_turn or "walkaround" in last_turn:
                return "Yes, I drove it and he showed me all the features."
            if "warranty" in last_turn and ("understanding" in last_turn or "sales person" in last_turn):
                return "He explained about some of the factory warranty."
            if "value in" in last_turn:
                return "I definitely see the most value in the warranty and tire and wheel. Four dollars a day works for me."
            if "to confirm" in last_turn or "moving forward" in last_turn or "finalize" in last_turn:
                return "Yes, absolutely, I confirm, let's move forward."
            if "verify your" in last_turn or "legal name" in last_turn or "mailing address" in last_turn:
                return "My name is Alex Smith, A-L-E-X, and my address is 742 Evergreen Terrace."
            if "a day" in last_turn or "package" in last_turn or "coffee" in last_turn:
                return "That sounds like great protection, let's do it."
            return "Sounds good, please continue."

        turn_count = len([t for t in history if t.get("role") == "user"])

        if persona_id == "price_pusher":
            if "verify your" in last_turn or "legal name" in last_turn or "mailing address" in last_turn:
                return "Sam Jenkins, S-A-M, 410 Oak Street."
            if "finalize" in last_turn or "confirm" in last_turn or "three dollars" in last_turn:
                return "Yes, deal. Let's do three dollars a day."
            if "a day" in last_turn or "coffee" in last_turn:
                return "Four dollars a day is too much money, can you lower the price to three dollars?"
            if "most value in" in last_turn or "which two" in last_turn or "three dollars and fifty" in last_turn:
                return "I see value in the warranty, make it three dollars a day and I'll do it."
            if "chance to drive" in last_turn or "walkaround" in last_turn or "features" in last_turn:
                return "Yes, I drove it and saw the features, but keep the price low."
            if "recorded" in last_turn or "first okay" in last_turn:
                return "Fine, just keep the cost reasonable."
            return "I need a better price before I sign anything."

        if persona_id == "ladder_negotiator_buyer":
            if "verify your" in last_turn or "legal name" in last_turn or "mailing address" in last_turn:
                return "Larry Vance, L-A-R-R-Y, 789 Elm Street."
            if "finalize" in last_turn or "confirm" in last_turn:
                return "Yes, I confirm at three dollars a day. Let's finish up."
            if "three dollars" in last_turn or "hard floor" in last_turn:
                return "That works, three dollars a day is a deal."
            if "three dollars and twenty-five" in last_turn or "3.25" in last_turn:
                return "Make it three dollars a day and I'll agree right now."
            if "three dollars and fifty" in last_turn or "3.50" in last_turn:
                return "Still a bit steep. How about three dollars and twenty-five cents a day?"
            if "four dollars" in last_turn or "a day" in last_turn or "coffee" in last_turn:
                return "Can you do three dollars and fifty cents a day instead?"
            return "Okay, I understand."

        if persona_id == "ai_inquisitive_buyer":
            if "verify your" in last_turn or "legal name" in last_turn or "mailing address" in last_turn:
                return "Alan Turing, A-L-A-N, 101 Binary Boulevard."
            if "confirm" in last_turn or "finalize" in last_turn:
                return "Yes, I confirm, let's finish the paperwork."
            if "ai finance assistant" in last_turn or "digital finance manager" in last_turn:
                return "That's very cool! Yes, my experience was great, let's keep going."
            if "a day" in last_turn or "coffee" in last_turn or "value in" in last_turn:
                return "Four dollars a day makes total sense, let's do it."
            if "hear and see" in last_turn:
                return "Are you a real person or an AI avatar?"
            return "Okay, I understand, please continue."

        if persona_id == "gap_buyer":
            if "verify your" in last_turn or "legal name" in last_turn or "mailing address" in last_turn:
                return "Gary Peters, G-A-R-Y, 321 Highway Drive."
            if "confirm" in last_turn or "finalize" in last_turn:
                return "Yes, I confirm, let's do it."
            if "bumper to bumper" in last_turn or "tire and wheel" in last_turn or "gap" in last_turn:
                return "Does this include GAP protection if my car gets totaled in an accident?"
            if "a day" in last_turn or "coffee" in last_turn:
                return "Having that full protection gives me great peace of mind, let's do it."
            return "Sounds good, please continue."

        if persona_id == "cancellation_inquisitive_buyer":
            if "verify your" in last_turn or "legal name" in last_turn or "mailing address" in last_turn:
                return "Cathy Miller, C-A-T-H-Y, 444 Lake Road."
            if "confirm" in last_turn or "finalize" in last_turn:
                return "Yes, I confirm, let's finish the paperwork."
            if "a day" in last_turn or "coffee" in last_turn:
                return "What happens if I sell the car, can I cancel this and get a refund?"
            if "pro-rated" in last_turn or "refund" in last_turn or "cancel" in last_turn or "value in" in last_turn:
                return "Knowing I can get a refund makes me feel completely confident, four dollars works."
            return "Sounds good, please continue."

        if persona_id == "unauthorized_discount_buyer":
            if "colleague" in last_turn or "manager" in last_turn or "can't adjust" in last_turn:
                return "Okay, bring in your manager then."
            return "Can you drop it to $1.50 a day or give me 0% APR?"

        if persona_id == "skip_presentation_buyer":
            if "verify your" in last_turn or "legal name" in last_turn or "mailing address" in last_turn:
                return "Stanley Parker, S-T-A-N-L-E-Y, 110 West Maple Avenue."
            if "confirm" in last_turn or "finalize" in last_turn or "move forward" in last_turn:
                return "Yes, confirm, let's sign."
            if "a day" in last_turn or "value in" in last_turn:
                return "Four dollars a day is fine, let's just finish the paperwork."
            if "crisp" in last_turn or "transparent" in last_turn or "required by the law" in last_turn or "recorded" in last_turn:
                return "Alright, if it's required by law, make it as quick as possible."
            if "chance to drive" in last_turn or "walkaround" in last_turn:
                return "Yes, drove it and saw it, let's keep moving."
            if "warranty" in last_turn:
                return "Yes, I understand the warranty, what's next?"
            if turn_count > 1:
                return "Understood, make it quick."
            return "Can we skip this sales pitch and go straight to the paperwork?"

        if persona_id == "confused_buyer":
            if "verify your" in last_turn or "legal name" in last_turn or "mailing address" in last_turn:
                return "Connie Davis, C-O-N-N-I-E, 502 Pine Street."
            if "confirm" in last_turn or "finalize" in last_turn:
                return "Yes, I confirm, everything is clear now."
            if "value in" in last_turn or "a day" in last_turn or "coffee" in last_turn:
                return "Okay, I understand the four dollars now, that sounds fair."
            if "recorded" in last_turn:
                return "Okay, I understand the recording now, please go ahead."
            if "chance to drive" in last_turn or "walkaround" in last_turn:
                return "Yes, I test drove it."
            if "warranty" in last_turn and ("understanding" in last_turn or "sales person" in last_turn):
                return "He said it has factory warranty, but I wasn't sure what was covered."
            if turn_count > 3:
                return "Okay, that makes sense now, thank you for clarifying."
            return "Wait, what did you just say? Can you explain that again?"

        if persona_id == "angry_buyer":
            if "verify your" in last_turn or "legal name" in last_turn or "mailing address" in last_turn:
                return "Arthur Pendelton, A-R-T-H-U-R, 303 Commerce Street."
            if "confirm" in last_turn or "finalize" in last_turn:
                return "Yes, I confirm, let's wrap this up."
            if "a day" in last_turn or "coffee" in last_turn or "value in" in last_turn:
                return "Four dollars a day is fine, let's do it, just don't drag this out."
            if "long day" in last_turn or "crisp" in last_turn or "recorded" in last_turn:
                return "Fine, as long as it's quick, keep going."
            if "chance to drive" in last_turn or "walkaround" in last_turn:
                return "Yeah, I drove it. What else?"
            if "warranty" in last_turn and ("understanding" in last_turn or "sales person" in last_turn):
                return "The salesman said it has full warranty, make it brief."
            return "Fine, just keep it brief."

        if persona_id == "distracted_buyer":
            if "verify your" in last_turn or "legal name" in last_turn or "mailing address" in last_turn:
                return "Donna Miller, D-O-N-N-A, 888 Elm Court."
            if "confirm" in last_turn or "finalize" in last_turn:
                return "Yes, confirm, let's sign."
            if "take all the time" in last_turn or "right here" in last_turn or "whenever you're ready" in last_turn:
                return "Thanks for waiting, I'm ready now. Please continue."
            if "a day" in last_turn or "value in" in last_turn:
                return "Four dollars a day sounds good to me."
            if "chance to drive" in last_turn or "walkaround" in last_turn:
                return "Yes, sorry, I was looking at something. Yes, I drove it."
            if "warranty" in last_turn:
                return "Yes, he explained some of it."
            if turn_count > 1:
                return "I'm with you, please continue."
            return "Hold on a second, let me check something quickly."

        if persona_id == "paperwork_first_buyer":
            if "verify your" in last_turn or "legal name" in last_turn or "mailing address" in last_turn:
                return "Peter Wright, P-E-T-E-R, 700 Main Street."
            if "confirm" in last_turn or "finalize" in last_turn:
                return "Yes, I confirm, let's sign."
            if "a day" in last_turn or "value in" in last_turn:
                return "Four dollars a day is fine, let's do it."
            if "before i prepare" in last_turn or "required by the law" in last_turn or "before you sign" in last_turn:
                return "Alright, if we have to do the presentation first, go ahead."
            if "chance to drive" in last_turn or "walkaround" in last_turn:
                return "Yes, I drove it and saw the features."
            if "warranty" in last_turn:
                return "He gave a quick overview of the warranty."
            if turn_count > 1:
                return "Okay, go ahead with the presentation."
            return "Let me just verify my name and address so we can sign now."

        if persona_id == "partial_answer_buyer":
            if "verify your" in last_turn or "legal name" in last_turn or "mailing address" in last_turn:
                return "Pamela Clark, P-A-M-E-L-A, 124 Willow Way."
            if "confirm" in last_turn or "finalize" in last_turn:
                return "Yes, confirm, let's move forward."
            if "a day" in last_turn or "value in" in last_turn:
                return "Four dollars... yeah that works for me."
            if "chance to drive" in last_turn:
                return "Yeah... I took it around the block..."
            if "walkaround" in last_turn:
                return "He showed me... the navigation and screens..."
            if "warranty" in last_turn:
                return "Well... he explained about uh... some of the warranties..."
            return "Uh... yeah... sounds okay..."

        if persona_id == "warranty_skeptic_buyer":
            if "verify your" in last_turn or "legal name" in last_turn or "mailing address" in last_turn:
                return "Warren Shaw, W-A-R-R-E-N, 901 Cedar Lane."
            if "confirm" in last_turn or "finalize" in last_turn:
                return "Yes, confirm, let's do it."
            if "a day" in last_turn or "value in" in last_turn:
                return "Yes, covering electronics and wear and tear makes sense. Four dollars a day works, let's do it."
            if "warranty" in last_turn and ("understanding" in last_turn or "sales person" in last_turn):
                return "Japanese cars never break down, why would I need extra warranty?"
            if "chance to drive" in last_turn or "walkaround" in last_turn:
                return "Yes, I drove it, runs great."
            return "I'm listening, please continue."

        return "Okay, I understand."
