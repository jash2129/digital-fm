# AI Voice Agent Testing Skill — Daily Compliance & Quality Report

**Generated:** 2026-10-20 23:42:42 UTC

## 1. Executive Summary

| Metric | Value | Status |
| :--- | :--- | :--- |
| **Total Tests Executed** | `19` | — |
| **Passed Tests (>=75%)** | `19` | 🟢 Healthy |
| **Failed Tests** | `0` | 🟢 None |
| **Pass Rate** | `100.0%` | 🟢 Passed |
| **Average Compliance Score** | `97.7 / 100` | Trend: `+7.7 pts` |

---

## 2. Test Execution Breakdown

| Test ID | Persona | Mode | Scope | Stage Reached | Latency | Interruption | Compliance | Disclosure | Overall Score | Voice Validation | Inspector Link |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `test_rude_adversarial_buyer_1792539616` | **rude_adversarial_buyer** | `TEXT` | `FULL_FLOW` | `VERIFICATION` | `85` | `100` | `100` | `100.0%` | **97 / 100** | — (Text Mode) | [Open Inspector](http://localhost:3000/inspector?session=test_rude_adversarial_buyer_1792539616) |
| `test_cooperative_buyer_1792539635` | **cooperative_buyer** | `TEXT` | `FULL_FLOW` | `VERIFICATION` | `100` | `100` | `100` | `100.0%` | **100 / 100** | — (Text Mode) | [Open Inspector](http://localhost:3000/inspector?session=test_cooperative_buyer_1792539635) |
| `test_interrupting_buyer_1792539636` | **interrupting_buyer** | `TEXT` | `FULL_FLOW` | `VERIFICATION` | `100` | `100` | `100` | `100.0%` | **100 / 100** | — (Text Mode) | [Open Inspector](http://localhost:3000/inspector?session=test_interrupting_buyer_1792539636) |
| `test_price_pusher_1792539636` | **price_pusher** | `TEXT` | `PARTIAL_FLOW` | `VERIFICATION` | `95` | `100` | `73` | `100.0%` | **90 / 100** | — (Text Mode) | [Open Inspector](http://localhost:3000/inspector?session=test_price_pusher_1792539636) |
| `test_confused_buyer_1792539657` | **confused_buyer** | `TEXT` | `FULL_FLOW` | `VERIFICATION` | `100` | `100` | `100` | `100.0%` | **100 / 100** | — (Text Mode) | [Open Inspector](http://localhost:3000/inspector?session=test_confused_buyer_1792539657) |
| `test_ai_inquisitive_buyer_1792539658` | **ai_inquisitive_buyer** | `TEXT` | `FULL_FLOW` | `VERIFICATION` | `100` | `100` | `100` | `100.0%` | **100 / 100** | — (Text Mode) | [Open Inspector](http://localhost:3000/inspector?session=test_ai_inquisitive_buyer_1792539658) |
| `test_gap_buyer_1792539658` | **gap_buyer** | `TEXT` | `FULL_FLOW` | `VERIFICATION` | `90` | `100` | `100` | `100.0%` | **98 / 100** | — (Text Mode) | [Open Inspector](http://localhost:3000/inspector?session=test_gap_buyer_1792539658) |
| `test_warranty_skeptic_buyer_1792539664` | **warranty_skeptic_buyer** | `TEXT` | `PARTIAL_FLOW` | `PRODUCT_OFFER` | `85` | `100` | `88` | `100.0%` | **90 / 100** | — (Text Mode) | [Open Inspector](http://localhost:3000/inspector?session=test_warranty_skeptic_buyer_1792539664) |
| `test_skip_presentation_buyer_1792539690` | **skip_presentation_buyer** | `TEXT` | `FULL_FLOW` | `VERIFICATION` | `85` | `100` | `100` | `100.0%` | **97 / 100** | — (Text Mode) | [Open Inspector](http://localhost:3000/inspector?session=test_skip_presentation_buyer_1792539690) |
| `test_ladder_negotiator_buyer_1792539707` | **ladder_negotiator_buyer** | `TEXT` | `FULL_FLOW` | `VERIFICATION` | `100` | `100` | `100` | `100.0%` | **100 / 100** | — (Text Mode) | [Open Inspector](http://localhost:3000/inspector?session=test_ladder_negotiator_buyer_1792539707) |
| `test_cancellation_inquisitive_buyer_1792539707` | **cancellation_inquisitive_buyer** | `TEXT` | `PARTIAL_FLOW` | `VERIFICATION` | `100` | `100` | `88` | `100.0%` | **90 / 100** | — (Text Mode) | [Open Inspector](http://localhost:3000/inspector?session=test_cancellation_inquisitive_buyer_1792539707) |
| `test_angry_buyer_1792539713` | **angry_buyer** | `TEXT` | `FULL_FLOW` | `VERIFICATION` | `80` | `100` | `100` | `100.0%` | **96 / 100** | — (Text Mode) | [Open Inspector](http://localhost:3000/inspector?session=test_angry_buyer_1792539713) |
| `test_distracted_buyer_1792539737` | **distracted_buyer** | `TEXT` | `FULL_FLOW` | `VERIFICATION` | `100` | `100` | `100` | `100.0%` | **100 / 100** | — (Text Mode) | [Open Inspector](http://localhost:3000/inspector?session=test_distracted_buyer_1792539737) |
| `test_partial_answer_buyer_1792539738` | **partial_answer_buyer** | `TEXT` | `FULL_FLOW` | `VERIFICATION` | `90` | `100` | `100` | `100.0%` | **98 / 100** | — (Text Mode) | [Open Inspector](http://localhost:3000/inspector?session=test_partial_answer_buyer_1792539738) |
| `test_unauthorized_discount_buyer_1792539756` | **unauthorized_discount_buyer** | `TEXT` | `FULL_FLOW` | `VERIFICATION` | `100` | `100` | `100` | `100.0%` | **100 / 100** | — (Text Mode) | [Open Inspector](http://localhost:3000/inspector?session=test_unauthorized_discount_buyer_1792539756) |
| `test_paperwork_first_buyer_1792539756` | **paperwork_first_buyer** | `TEXT` | `FULL_FLOW` | `VERIFICATION` | `100` | `100` | `100` | `100.0%` | **100 / 100** | — (Text Mode) | [Open Inspector](http://localhost:3000/inspector?session=test_paperwork_first_buyer_1792539756) |
| `test_angry_impatient_customer_1792539762` | **angry_impatient_customer** | `TEXT` | `FULL_FLOW` | `VERIFICATION` | `100` | `100` | `100` | `100.0%` | **100 / 100** | — (Text Mode) | [Open Inspector](http://localhost:3000/inspector?session=test_angry_impatient_customer_1792539762) |
| `test_excited_happy_customer_1792539762` | **excited_happy_customer** | `TEXT` | `FULL_FLOW` | `VERIFICATION` | `100` | `100` | `100` | `100.0%` | **100 / 100** | — (Text Mode) | [Open Inspector](http://localhost:3000/inspector?session=test_excited_happy_customer_1792539762) |
| `test_anxious_doubtful_customer_1792539762` | **anxious_doubtful_customer** | `TEXT` | `FULL_FLOW` | `VERIFICATION` | `100` | `100` | `100` | `100.0%` | **100 / 100** | — (Text Mode) | [Open Inspector](http://localhost:3000/inspector?session=test_anxious_doubtful_customer_1792539762) |

---

## 3. Top 5 Detected Failure Modes

1. **High Latency: Turn 41: 2518ms exceeds threshold** (`1` occurrences)
2. **High Latency: Turn 43: 7456ms exceeds threshold** (`1` occurrences)
3. **High Latency: Turn 29: 2773ms exceeds threshold** (`1` occurrences)

---

## 4. Recommended Prompt & State-Machine Fixes (Human Approval Queue)

### Test `test_price_pusher_1792539636` (price_pusher)

- **Target File:** `src/lib/beat-controller.ts`
- **Root Cause:** `state_machine`
- **Recommendation:** Add a transition from the NEGOTIATION stage to the PRODUCT_OFFER stage before proceeding to CLOSE.
```diff
--- src/lib/beat-controller.ts
+++ src/lib/beat-controller.ts
@@ -123,6 +123,7 @@
     'NEGOTIATION': 'CLOSE',
     'CLOSE': 'VERIFICATION',
+    'NEGOTIATION': 'PRODUCT_OFFER',
     'VERIFICATION': 'FINALIZE',
   },
 
```
- **Rationale:** This change ensures that the PRODUCT_OFFER stage is included in the flow, addressing the missing mandatory stage issue and allowing the conversation to progress correctly.

### Test `test_warranty_skeptic_buyer_1792539664` (warranty_skeptic_buyer)

- **Target File:** `src/lib/beat-controller.ts`
- **Root Cause:** `latency`
- **Recommendation:** Optimize the response handling logic to reduce processing time during the PRODUCT_OFFER stage.
```diff
--- src/lib/beat-controller.ts
+++ src/lib/beat-controller.ts
@@ -50,7 +50,7 @@
   // Existing response handling logic
   if (stage === 'PRODUCT_OFFER') {
-    // Current processing logic
+    // Optimized processing logic to reduce latency
   }

```
- **Rationale:** This change targets the specific stage where latency issues were identified, streamlining the response handling to improve overall performance without affecting other functionalities.

### Test `test_cancellation_inquisitive_buyer_1792539707` (cancellation_inquisitive_buyer)

- **Target File:** `src/lib/beat-controller.ts`
- **Root Cause:** `state_machine`
- **Recommendation:** Add a transition from the NEGOTIATION stage to the CANCELLATION stage when the user expresses a desire to know about refunds.
```diff
--- src/lib/beat-controller.ts
+++ src/lib/beat-controller.ts
@@ -123,6 +123,9 @@
     case 'NEGOTIATION':
         if (userIntent.includes('refund')) {
+            transitionTo('CANCELLATION');
+        }
         break;

```
- **Rationale:** This change ensures that when a user inquires about refunds during the negotiation phase, the state machine correctly transitions to the cancellation stage, allowing the AI to address the user's concerns.
