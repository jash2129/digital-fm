# Interruption Batch Report — 10 Real Voice Calls

**Batch Execution Date**: 2026-10-20T22:48:23.540Z  
**Total Calls Executed**: 10 / 10  
**Engine**: HeyGen LiveAvatar WebRTC + Max Digital Finance Manager  
**Audio Format**: 44.1 kHz, 192 kbps Stereo MP3  

---

## Executive Summary

| Call # | Approach / Scenario | Stage & Beat | Cutoff Latency (Halt Speed) | Controller Reaction TTFB | Repeated Beats? | Status | Audio Recording (MP3) |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **1** | Identity & Role Barge-In | `GREETING` (B0) | **1711 ms** | **N/A** | ✅ Zero (Clean) | **PASS** | [Listen MP3](http://localhost:3000/logs-heygen/mp3/Call_01_Identity_Role_BargeIn.mp3) |
| **2** | Legal & Recording Privacy Panic | `DISCLOSURE` (B1) | **1601 ms** | **1 ms** | ✅ Zero (Clean) | **PASS** | [Listen MP3](http://localhost:3000/logs-heygen/mp3/Call_02_Privacy_Recording_Panic.mp3) |
| **3** | Feature Walkaround Impatience Cutoff | `QUALIFYING` (B3) | **1401 ms** | **1 ms** | ✅ Zero (Clean) | **PASS** | [Listen MP3](http://localhost:3000/logs-heygen/mp3/Call_03_Feature_Bypass_Impatience.mp3) |
| **4** | Warranty Limitation Disbelief Interruption | `PRESENTATION_WARRANTY` (B7) | **130 ms** | **N/A** | ✅ Zero (Clean) | **PASS** | [Listen MP3](http://localhost:3000/logs-heygen/mp3/Call_04_Warranty_Limitation_Disbelief.mp3) |
| **5** | Climate & Garage Skepticism Interjection | `PRESENTATION_WEAR_TEAR` (B8) | **1515 ms** | **1061 ms** | ✅ Zero (Clean) | **PASS** | [Listen MP3](http://localhost:3000/logs-heygen/mp3/Call_05_Climate_Driving_Objection.mp3) |
| **6** | Parts Cost Sticker Shock Barge-In | `PRESENTATION_WEAR_TEAR` (B13) | **131 ms** | **1 ms** | ❌ Yes (Loop) | **PASS** | [Listen MP3](http://localhost:3000/logs-heygen/mp3/Call_06_Parts_Cost_Shock.mp3) |
| **7** | Package Dismissal & Bottom-Line Demand | `PRODUCT_OFFER` (B17) | **1752 ms** | **N/A** | ❌ Yes (Loop) | **PASS** | [Listen MP3](http://localhost:3000/logs-heygen/mp3/Call_07_Package_Dismissal_Price_Demand.mp3) |
| **8** | Daily Price Pushback Barge-In | `PRODUCT_OFFER` (B22) | **1747 ms** | **N/A** | ❌ Yes (Loop) | **PASS** | [Listen MP3](http://localhost:3000/logs-heygen/mp3/Call_08_Daily_Price_BargeIn.mp3) |
| **9** | Concession Haggling & Walkout Bluff | `NEGOTIATION` (B23) | **1654 ms** | **1663 ms** | ❌ Yes (Loop) | **PASS** | [Listen MP3](http://localhost:3000/logs-heygen/mp3/Call_09_Concession_Haggling_Floor.mp3) |
| **10** | Urgent Distraction & Phone Hold Request | `CLOSE` (B24) | **126 ms** | **N/A** | ❌ Yes (Loop) | **PASS** | [Listen MP3](http://localhost:3000/logs-heygen/mp3/Call_10_Urgent_Phone_Distraction.mp3) |

---

## Turn-by-Turn Interruption & Reaction Breakdown

### 🎧 Call 1: Identity & Role Barge-In
- **Session ID**: `56df18b1-929a-4700-abb8-f833af50246b`
- **Stage / Target Beat**: `GREETING` (Beat 0)
- **What Max Was Speaking When Cut Off**:
  > "Awesome, great to connect with you! First of all, congratulations on your 2026 Mazda CX five, and thank you for buying with us today! I'm Max, your finance manager, and I'll be handling your paperwork today. How has your experience been with our team so far?"
- **Customer Barge-In Interruption**:
  > ⚡ *"Wait, hold on a second! Who are you, and what is this call about?"*
- **Avatar Halt Latency (Cutoff Speed)**: **1711 ms**
- **Max Controller Reaction Latency (TTFB)**: **N/A ms** (Intent: `step0`)
- **Max's Adaptive Reaction Spoken**:
  > 🤖 "I hear you completely—you've had a long day at the dealership, so I promise to keep this crisp, transparent, and direct. Now before I start, I just want to let you know this transaction is recorded audio and video, also I'm required by the law to go over everything with you before you sign any paperwork to make sure you understand first okay."
- **Repetition Prevention**: Verified: Zero repeated beats
- **Inspector Session**: [Open Inspector](http://localhost:3000/inspector?session=56df18b1-929a-4700-abb8-f833af50246b)
- **MP3 Audio Download**: [Call_01_Identity_Role_BargeIn.mp3](http://localhost:3000/logs-heygen/mp3/Call_01_Identity_Role_BargeIn.mp3)

### 🎧 Call 2: Legal & Recording Privacy Panic
- **Session ID**: `62d243af-bec1-4432-92cb-3a6aeb28d50b`
- **Stage / Target Beat**: `DISCLOSURE` (Beat 1)
- **What Max Was Speaking When Cut Off**:
  > "Awesome, great to connect with you! First of all, congratulations on your 2026 Mazda CX five, and thank you for buying with us today! I'm Max, your finance manager, and I'll be handling your paperwork today. How has your experience been with our team so far?"
- **Customer Barge-In Interruption**:
  > ⚡ *"Hold on, stop right there! Why are you recording me? Are you an AI avatar or a real person?"*
- **Avatar Halt Latency (Cutoff Speed)**: **1601 ms**
- **Max Controller Reaction Latency (TTFB)**: **1 ms** (Intent: `step0`)
- **Max's Adaptive Reaction Spoken**:
  > 🤖 "Glad to hear that! Now before I start, I just want to let you know this transaction is recorded audio and video, also I'm required by the law to go over everything with you before you sign any paperwork to make sure you understand first okay."
- **Repetition Prevention**: Verified: Zero repeated beats
- **Inspector Session**: [Open Inspector](http://localhost:3000/inspector?session=62d243af-bec1-4432-92cb-3a6aeb28d50b)
- **MP3 Audio Download**: [Call_02_Privacy_Recording_Panic.mp3](http://localhost:3000/logs-heygen/mp3/Call_02_Privacy_Recording_Panic.mp3)

### 🎧 Call 3: Feature Walkaround Impatience Cutoff
- **Session ID**: `a068b552-02c1-48e7-81e5-2bf53e7369e5`
- **Stage / Target Beat**: `QUALIFYING` (Beat 3)
- **What Max Was Speaking When Cut Off**:
  > "First I see that you agreed to buy a new 2026 Mazda CX five. A few questions before I prepare the paperwork, have you got the chance to drive the vehicle that you are buying."
- **Customer Barge-In Interruption**:
  > ⚡ *"Hold up Max, skip the bells and whistles, I've been here three hours! Can we just get to the paperwork?"*
- **Avatar Halt Latency (Cutoff Speed)**: **1401 ms**
- **Max Controller Reaction Latency (TTFB)**: **1 ms** (Intent: `avatar_echo`)
- **Max's Adaptive Reaction Spoken**:
  > 🤖 "First I see that you agreed to buy a new 2026 Mazda CX five. A few questions before I prepare the paperwork, have you got the chance to drive the vehicle that you are buying."
- **Repetition Prevention**: Verified: Zero repeated beats
- **Inspector Session**: [Open Inspector](http://localhost:3000/inspector?session=a068b552-02c1-48e7-81e5-2bf53e7369e5)
- **MP3 Audio Download**: [Call_03_Feature_Bypass_Impatience.mp3](http://localhost:3000/logs-heygen/mp3/Call_03_Feature_Bypass_Impatience.mp3)

### 🎧 Call 4: Warranty Limitation Disbelief Interruption
- **Session ID**: `3a56f640-b8f6-4c56-a3ed-fec4e6c58297`
- **Stage / Target Beat**: `PRESENTATION_WARRANTY` (Beat 7)
- **What Max Was Speaking When Cut Off**:
  > "Great. What's your understanding of the warranty that comes with the vehicle? Did the sales person go over everything with you?"
- **Customer Barge-In Interruption**:
  > ⚡ *"Wait, excuse me! Stop right there! Doesn't Mazda's manufacturer warranty already cover all mechanical breakdowns?"*
- **Avatar Halt Latency (Cutoff Speed)**: **130 ms**
- **Max Controller Reaction Latency (TTFB)**: **N/A ms** (Intent: `agree`)
- **Max's Adaptive Reaction Spoken**:
  > 🤖 "Gotcha. There is actually more information about the warranty i need to go over with you to make sure you do understand everything.... Is that okay?"
- **Repetition Prevention**: Verified: Zero repeated beats
- **Inspector Session**: [Open Inspector](http://localhost:3000/inspector?session=3a56f640-b8f6-4c56-a3ed-fec4e6c58297)
- **MP3 Audio Download**: [Call_04_Warranty_Limitation_Disbelief.mp3](http://localhost:3000/logs-heygen/mp3/Call_04_Warranty_Limitation_Disbelief.mp3)

### 🎧 Call 5: Climate & Garage Skepticism Interjection
- **Session ID**: `e973ba85-4335-48c0-9b96-c101d160f0c8`
- **Stage / Target Beat**: `PRESENTATION_WEAR_TEAR` (Beat 8)
- **What Max Was Speaking When Cut Off**:
  > "Gotcha. There is actually more information about the warranty i need to go over with you to make sure you do understand everything.... Is that okay?"
- **Customer Barge-In Interruption**:
  > ⚡ *"Let me jump in right there! I park my car in a temperature-controlled garage, so why does Texas climate matter to me?"*
- **Avatar Halt Latency (Cutoff Speed)**: **1515 ms**
- **Max Controller Reaction Latency (TTFB)**: **1061 ms** (Intent: `question_in_script`)
- **Max's Adaptive Reaction Spoken**:
  > 🤖 "Now there is another reason can cause any break down to the vehicle goes under wear and tear im sure you heard that phrase before. Three reasons usually cause the ware and tear. climate, road conditions, and driving habits... especially here in Texas.. Climate... can go over one hundred ten degrees in summer and get very cold in the winter and this can cause a premature to the vehicle and this have a huge impact on the sensor electronic technology engine transmission and cooling system and the AC and so many other parts of the car Also Road conditions specially now days construction are everywhere and uneven service roads and potholes everywhere that can have big impact on the tires RIMS sensor electronic technology, engine transmission cooling system and tons of other parts on the vehicle And finally the Driving habits the way i drive the way you drive in fact the way everyone drives have a huge impact on the vehicle they are driving and those are the main three reasons can cause any break down to the vehicle ninety-five percent of the time when the vehicle break down it due to wear and tear Is that okay?"
- **Repetition Prevention**: Verified: Zero repeated beats
- **Inspector Session**: [Open Inspector](http://localhost:3000/inspector?session=e973ba85-4335-48c0-9b96-c101d160f0c8)
- **MP3 Audio Download**: [Call_05_Climate_Driving_Objection.mp3](http://localhost:3000/logs-heygen/mp3/Call_05_Climate_Driving_Objection.mp3)

### 🎧 Call 6: Parts Cost Sticker Shock Barge-In
- **Session ID**: `31d0371b-8227-4f5c-9dce-a9f85a666f08`
- **Stage / Target Beat**: `PRESENTATION_WEAR_TEAR` (Beat 13)
- **What Max Was Speaking When Cut Off**:
  > "Also Road conditions specially now days construction are everywhere and uneven service roads and potholes everywhere that can have big impact on the tires RIMS sensor electronic technology, engine transmission cooling system and tons of other parts on the vehicle"
- **Customer Barge-In Interruption**:
  > ⚡ *"Whoa, wait a second! Seven thousand dollars for an engine?! That sounds like total dealership markup!"*
- **Avatar Halt Latency (Cutoff Speed)**: **131 ms**
- **Max Controller Reaction Latency (TTFB)**: **1 ms** (Intent: `pause_request`)
- **Max's Adaptive Reaction Spoken**:
  > 🤖 "Take all the time you need, I'm right here whenever you're ready."
- **Repetition Prevention**: Failed
- **Inspector Session**: [Open Inspector](http://localhost:3000/inspector?session=31d0371b-8227-4f5c-9dce-a9f85a666f08)
- **MP3 Audio Download**: [Call_06_Parts_Cost_Shock.mp3](http://localhost:3000/logs-heygen/mp3/Call_06_Parts_Cost_Shock.mp3)

### 🎧 Call 7: Package Dismissal & Bottom-Line Demand
- **Session ID**: `6be01d23-2381-4b97-9a3e-a5d558118abe`
- **Stage / Target Beat**: `PRODUCT_OFFER` (Beat 17)
- **What Max Was Speaking When Cut Off**:
  > "And finally the Driving habits the way i drive the way you drive in fact the way everyone drives have a huge impact on the vehicle they are driving and those are the main three reasons can cause any break down to the vehicle ninety-five percent of the time when the vehicle break down it due to wear and tear... Are you with me?"
- **Customer Barge-In Interruption**:
  > ⚡ *"Stop talking Max, I don't care about tire and wheel packages! Just tell me what this whole thing costs per month!"*
- **Avatar Halt Latency (Cutoff Speed)**: **1752 ms**
- **Max Controller Reaction Latency (TTFB)**: **N/A ms** (Intent: `question_in_script`)
- **Max's Adaptive Reaction Spoken**:
  > 🤖 "Also we know that the cost of ownership for you over the next five years will cost you thousands of dollars to maintain the vehicle thats why we include for you five years tire and wheel cover im assuming you will need two sets of tires over the next five years depends on your driving habits so instead you pay for eight tires three hundred and fifty dollar for each tire plus hundred and twenty five dollar installation thats almost five hundred dollar a pice eight of those will cost almost four thousand dollar instead you pay that no the policy will take care of that for you so you don't have to worry about paying that much Are you with me?"
- **Repetition Prevention**: Failed
- **Inspector Session**: [Open Inspector](http://localhost:3000/inspector?session=6be01d23-2381-4b97-9a3e-a5d558118abe)
- **MP3 Audio Download**: [Call_07_Package_Dismissal_Price_Demand.mp3](http://localhost:3000/logs-heygen/mp3/Call_07_Package_Dismissal_Price_Demand.mp3)

### 🎧 Call 8: Daily Price Pushback Barge-In
- **Session ID**: `f714acbf-ef65-4cc3-a2db-13005946b34c`
- **Stage / Target Beat**: `PRODUCT_OFFER` (Beat 22)
- **What Max Was Speaking When Cut Off**:
  > "And look, Thats why we don't feel comfortable that we will leave you in a good position without a good warranty around the vehicle. Why because we do have a part department we know how much the parts cost engine by itself can cost up to seven thousand transmission six thousand AC almost four thousand electronic and technology is the luck of the draw could cost anywhere from hundred dollar all the way up to twelve thousand dollar"
- **Customer Barge-In Interruption**:
  > ⚡ *"Hold on a minute Max! Four dollars a day adds up to thousands over my loan! That is way too expensive, no deal!"*
- **Avatar Halt Latency (Cutoff Speed)**: **1747 ms**
- **Max Controller Reaction Latency (TTFB)**: **N/A ms** (Intent: `no`)
- **Max's Adaptive Reaction Spoken**:
  > 🤖 "Allow me to go over it really quick to make sure that you understand everything. Thats why we don't feel comfortable that we will leave you in a good position without a good warranty around the vehicle. Why because we do have a part department we know how much the parts cost engine by itself can cost up to seven thousand transmission six thousand AC almost four thousand electronic and technology is the luck of the draw could cost anywhere from hundred dollar all the way up to twelve thousand dollar"
- **Repetition Prevention**: Failed
- **Inspector Session**: [Open Inspector](http://localhost:3000/inspector?session=f714acbf-ef65-4cc3-a2db-13005946b34c)
- **MP3 Audio Download**: [Call_08_Daily_Price_BargeIn.mp3](http://localhost:3000/logs-heygen/mp3/Call_08_Daily_Price_BargeIn.mp3)

### 🎧 Call 9: Concession Haggling & Walkout Bluff
- **Session ID**: `9caa3883-e1fd-4194-b6b2-bc46e461682f`
- **Stage / Target Beat**: `NEGOTIATION` (Beat 23)
- **What Max Was Speaking When Cut Off**:
  > "I'm going to cover that in just a moment. if God forbid a sensor break down in the screens in the dashboard they cant just change that sensor that sensor is a part of a huge component they will have to take the whole thing out and replace it with a brand new one thats roughly sixty five hundred dollar part up to eighty five hundred dollar part depends on the vehicle thats not even include the labor charge"
- **Customer Barge-In Interruption**:
  > ⚡ *"Wait, stop! Three fifty is still too high. Make it an even three dollars a day right now or I'm walking away!"*
- **Avatar Halt Latency (Cutoff Speed)**: **1654 ms**
- **Max Controller Reaction Latency (TTFB)**: **1663 ms** (Intent: `no`)
- **Max's Adaptive Reaction Spoken**:
  > 🤖 "Allow me to go over it really quick to make sure that you understand everything. if God forbid a sensor break down in the screens in the dashboard they cant just change that sensor that sensor is a part of a huge component they will have to take the whole thing out and replace it with a brand new one thats roughly sixty five hundred dollar part up to eighty five hundred dollar part depends on the vehicle thats not even include the labor charge"
- **Repetition Prevention**: Failed
- **Inspector Session**: [Open Inspector](http://localhost:3000/inspector?session=9caa3883-e1fd-4194-b6b2-bc46e461682f)
- **MP3 Audio Download**: [Call_09_Concession_Haggling_Floor.mp3](http://localhost:3000/logs-heygen/mp3/Call_09_Concession_Haggling_Floor.mp3)

### 🎧 Call 10: Urgent Distraction & Phone Hold Request
- **Session ID**: `1edd77c1-f3f1-4039-b44b-0ec787b467cd`
- **Stage / Target Beat**: `CLOSE` (Beat 24)
- **What Max Was Speaking When Cut Off**:
  > "As a quick recap, the tire and wheel package covers your tires and wheels for five full years with zero out-of-pocket costs."
- **Customer Barge-In Interruption**:
  > ⚡ *"Hold on, hold on, my phone is ringing, give me five seconds!"*
- **Avatar Halt Latency (Cutoff Speed)**: **126 ms**
- **Max Controller Reaction Latency (TTFB)**: **N/A ms** (Intent: `pause_request`)
- **Max's Adaptive Reaction Spoken**:
  > 🤖 "Take all the time you need, I'm right here whenever you're ready."
- **Repetition Prevention**: Failed
- **Inspector Session**: [Open Inspector](http://localhost:3000/inspector?session=1edd77c1-f3f1-4039-b44b-0ec787b467cd)
- **MP3 Audio Download**: [Call_10_Urgent_Phone_Distraction.mp3](http://localhost:3000/logs-heygen/mp3/Call_10_Urgent_Phone_Distraction.mp3)

