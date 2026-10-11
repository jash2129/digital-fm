# Digital Finance Manager (Max) — Client Specification & Data Verification Document

**Document Purpose**: This document outlines the complete financial data, repair benchmarks, bundled protection products, and negotiation guardrails configured in the Digital Finance Manager (Max). 
Please review the tables below to confirm accuracy against your dealership's DMS, warranty contracts, and service department rates. If any numbers or policies need adjustment, mark them in the **"Client Confirmation / Notes"** column.

---

## 1. Baseline Deal & Vehicle Context

| Field | Configured Default | Client Confirmation / Dealership Value | Description / Rationale |
| :--- | :--- | :--- | :--- |
| **Dealership Name** | `[Your Dealership Name]` | `[ ] Confirm: ____________________` | Used by Max in disclosure and greeting. |
| **Vehicle Benchmark** | 2026 Mazda CX-50 2.5 Turbo | `[ ] Confirm: ____________________` | Base vehicle profile for script benchmarks. |
| **Base Vehicle Payment** | $450.00 / month | `[ ] Confirm: $________ / mo` | Customer's agreed car payment before F&I. |
| **Deal Identification** | Dynamic CRM/DMS UUID | `[ ] Integrated via DMS / Manual` | Ties to the customer's jacket and paperwork. |

---

## 2. Factory Warranty vs. "Defect Only" Truth Table (Square 1 & 2)

Max uses this distinction to transition the customer from complimentary coverage to the necessity of wear-and-tear protection.

| Coverage Type | Term / Limit | What It Covers | What It Excludes (The "Defect Only" Limitation) | Client Sign-off |
| :--- | :--- | :--- | :--- | :---: |
| **Base Limited Warranty** | 5 Years / 60,000 Miles | Bumper-to-bumper factory coverage. | **Defect only** (misdesigned, misbuilt, or misinstalled at factory). Excludes 95% of real-world breakdowns. | `[ ] Approved` |
| **Powertrain Warranty** | 10 Years / 100,000 Miles | Engine, transmission, drivetrain. | **Defect only**. Wear & tear caused by heat, cold, potholes, or driving habits is **not** covered by manufacturer. | `[ ] Approved` |
| **Manufacturer Policy Reference** | Glove box manual, page 4 | Explicit legal notice that manufacturer coverage applies strictly against defects in material/workmanship. | Does not cover everyday component breakdown after miles accumulate. | `[ ] Approved` |

---

## 3. Real-World Repair Cost Anchors & Wear-and-Tear Drivers (Square 3)

Max cites these specific figures to anchor the customer's financial risk before introducing the protection bundle.

| Component / Service Item | Quoted Repair Cost Range | Typical Labor Required | Total Out-of-Pocket Risk | Client Verification / Custom Rate |
| :--- | :--- | :--- | :--- | :--- |
| **Engine Assembly / Replacement** | $7,000 – $8,000 *(Benchmark: $7,500)* | 10 – 15 hours labor | **~$8,500 – $10,000+** | `[ ] Confirmed: $____________` |
| **Transmission Replacement** | $5,000 – $6,000 | 8 – 12 hours labor | **~$6,500 – $7,800** | `[ ] Confirmed: $____________` |
| **A/C System & Climate Control** | $3,000 – $4,000 *(Compressor, Evaporator, Lines)* | 6 – 10 hours labor | **~$3,800 – $5,200** | `[ ] Confirmed: $____________` |
| **Dealership Labor Rate** | $130 – $160 / hour | N/A (Standard shop hourly rate) | Base hourly labor multiplier | `[ ] Confirmed: $____ / hour` |
| **In-House Deductible (Home)** | **$0 Deductible** | When servicing at your dealership | **$0 out of pocket** | `[ ] Confirmed: $0 / Other: $___` |
| **Outside Service Deductible** | **$350 Deductible** | When servicing at external repair shops | Covered with 10-day rental car | `[ ] Confirmed: $350 / Other: $___` |
| **Rental Car Allowance** | Up to **10 Days** covered | Provided during active warranty repair | Prevents alternate transport costs | `[ ] Confirmed: 10 Days / ____` |

### The Three Wear-and-Tear Drivers Max Explains:
1. **Climate Extremes**: Extreme summer heat (110°F+) and winter freezes degrade sensors, cooling systems, engine seals, and vehicle electronics.
2. **Road Conditions**: Constant road construction, uneven highways, and potholes damage steering, suspension, rims, and alignment.
3. **Driving Habits**: Natural braking, acceleration, stop-and-go commuting wear down components over the vehicle lifespan.
> **Key Metric Cited by Max**: *"95% of vehicle breakdowns are wear and tear, not manufacturer defect. When diagnosed, if it's wear and tear, the customer pays 100% of the bill."*

---

## 4. The Four Bundled Protection Products (Square 4)

Max presents these four products as **one unified wrap policy** — never à la carte — so the customer feels completely protected.

| Order | Product | Term / Limit | What It Covers (Max's Script) | Zero-Deductible Benefit | Client Confirmation |
| :---: | :--- | :--- | :--- | :--- | :---: |
| **1** | **VSC (Vehicle Service Contract)** | 10 Years / 100,000 Miles | Comprehensive wrap: Engine, transmission, drive axle, AWD, steering, suspension, electrical, AC, infotainment, sensors, and labor. | $0 out-of-pocket deductible for covered repairs. | `[ ] Confirmed` |
| **2** | **Maintenance Plan** | 5 Years | Full synthetic oil changes, engine & cabin filters, tire rotations, scheduled factory maintenance. | Covers scheduled services for 5 full years. | `[ ] Confirmed` |
| **3** | **Tire & Wheel Protection** | 5 Years | Road hazard blowouts replaced free; cosmetic rim damage and curb rash from potholes repaired. | Zero replacement cost for road hazard tires/rims. | `[ ] Confirmed` |
| **4** | **Total GAP Protection** | Full Loan Term | If vehicle is totaled, stolen, or destroyed (accident, flood, fire, theft), GAP pays the difference between insurance payout and loan balance. | Protects customer from paying for a car they no longer have. | `[ ] Confirmed` |

---

## 5. Deterministic Negotiation Ladder & Concession Guardrails (Step 5)

Max is programmatically restricted from improvising prices. Every concession is strictly governed by this deterministic ladder:

| Stage | Quoted Daily Rate | Equivalent Monthly Rate | Max's Conversation Strategy & Verbatim Script | Tool Action | Floor Status |
| :---: | :---: | :---: | :--- | :--- | :---: |
| **Stage 1** | **$4.00 / day** | **~$120.00 / mo** | **Opening Anchor**: *"I can get you everything for only $4 a day — about the cost of half a cup of Starbucks coffee."* | `propose_concession(1)` | Active Anchor |
| **Stage 2** | **$3.50 / day** | **~$105.00 / mo** | **Value Reframe**: Ask which 2 products have the highest value to them, re-anchor benefits, drop to $3.50. | `propose_concession(2)` | Approved Drop |
| **Stage 3** | **$3.25 / day** | **~$97.50 / mo** | **Loyalty & Partnership**: *"We are miles away... It's like Mission Impossible, and my name is not Tom Cruise."* Asks for Google review / referral in exchange for concession. | `propose_concession(3)` | Approved Drop |
| **Stage 4** | **$3.00 / day** | **~$90.00 / mo** | **Absolute Floor**: Defends floor firmly. *"No, no, $3.25 is already incredible. I can do $3.00 at absolute minimum."* | `propose_concession(4)` | **HARD FLOOR** |
| **Breach** | **< $3.00 / day** | **< $90.00 / mo** | **Programmatic Hard Stop**: Rejection triggered. Max says: *"I cannot adjust the price past this point myself — let me get my manager to see what else we can do for you."* | `escalate_to_human()` | **BLOCKED (Requires Manager)** |

---

## 6. Monotonic 10-Stage Pipeline Order (No Skipping, No Reordering)

The conversation flows in a strict sequential order to prevent the avatar from getting trapped or overwhelming the customer:

| Stage # | Stage Name | Purpose & Primary Customer Interaction | Visual Panel Display |
| :---: | :--- | :--- | :--- |
| **Stage 0** | **Dynamic Rapport** | Unscripted natural conversation. Small talk about test drive, weather, or dealership experience. No early identity or address questions. | Clean Avatar Video |
| **Step 1** | **Formal Greeting** | Warm professional welcome as the Digital Finance Manager handling paperwork. | Clean Avatar Video |
| **Step 2** | **Legal Disclosure** | Audio/video recording notice & mandatory disclosure consent: *"This transaction is recorded for insurance purposes... is that okay?"* | Consent check |
| **Step 3** | **Qualifying Questions** | 3 sequential questions: 1) Driven car? 2) Walk-around done? 3) Warranty explained? (Branches into warranty hook). | Clean Avatar Video |
| **Step 4** | **Four Square Presentation** | Progressive live-drawing: Square 1-2 Hook (Defect only) → Square 3 Story (Costs) → Square 4 Offer (VSC, Maint, Tire, GAP @ $4/day). | Progressive 2x2 Excalidraw Grid & Cost Panels |
| **Step 5** | **Objection & Negotiation** | Staged price ladder ($4.00 → $3.50 → $3.25 → $3.00). Value re-anchoring and review exchange. | Pricing Ladder View |
| **Step 6** | **Verbal Agreement (Close)** | Unambiguous verbal consent to agreed package and exact daily rate. | Deal Summary Card |
| **Step 7** | **Identity & Address Verification** | **Strictly locked until Step 6 close**. Quick name spelling and address confirmation for legal forms. | Verification Unlock |
| **Step 8** | **Payment Collection** | Payment link issuance (SMS/Email) covering down payment/F&I package. Wait for confirmed receipt. | Payment Link Sheet |
| **Step 9** | **Two-Stage Document Signing** | **Part A**: Dealership paperwork.<br>**Part B**: RouteOne lender contract (required on large/shared screen, never phone). | Final Signing Portal |

---

## 7. Client Sign-Off & Customization Form

Please fill out or sign below to confirm that these figures and workflow match your dealership's operational requirements:

- [ ] **All warranty terms & product descriptions confirmed as written.**
- [ ] **Repair cost estimates ($7,500 engine, $6,000 transmission, $3,500 AC) confirmed.**
- [ ] **Pricing tiers ($4.00, $3.50, $3.25, $3.00 floor) approved.**
- [ ] **Changes requested** (please note any specific edits below):

```text
Notes / Custom Dealership Values:
____________________________________________________________________________________
____________________________________________________________________________________
____________________________________________________________________________________
```

**Client / Dealership Stakeholder Name**: ___________________________________________  
**Dealership / Entity**: ___________________________________________________________  
**Date**: ________________________  
