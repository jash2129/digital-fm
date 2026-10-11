# Implementation Task — Live-Drawing Excalidraw Panel for Max
*For Claude Code. Adds a progressive, "watching it get drawn" Excalidraw panel to the existing Tavus-based DFM app, replacing (or sitting alongside) the static content panel. No paid account needed — @excalidraw/excalidraw is free, MIT-licensed, npm-installed.*

---

## Goal

When Max reaches the Four Square presentation, instead of a static graphic appearing, the customer watches a 2x2 grid get drawn on screen progressively — one box/label at a time, timed to roughly match what Max is saying at that moment.

---

## STEP 1 — Install

```bash
npm install @excalidraw/excalidraw
```

No API key, no account, no sign-up required — this is a self-hosted open-source package, not a hosted service.

---

## STEP 2 — Create the Excalidraw panel component

Create `components/PresentationCanvas.tsx`:

```tsx
"use client";

import { useState, useRef } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

export default function PresentationCanvas() {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  const elementsRef = useRef<any[]>([]); // accumulates elements across calls

  // Exposed so the tool-call handler (Step 4) can push new elements
  (window as any).__addToCanvas = async (newElementSkeletons: any[]) => {
    if (!excalidrawAPI) return;
    const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
    const converted = convertToExcalidrawElements(newElementSkeletons);
    elementsRef.current = [...elementsRef.current, ...converted];
    excalidrawAPI.updateScene({
      elements: elementsRef.current,
      captureUpdate: "NEVER" as any, // avoid polluting undo history for AI-driven updates
    });
  };

  (window as any).__clearCanvas = () => {
    elementsRef.current = [];
    excalidrawAPI?.updateScene({ elements: [], captureUpdate: "NEVER" as any });
  };

  return (
    <div style={{ height: "100%", width: "100%" }}>
      {/* Excalidraw itself is loaded lazily by the parent — see Step 3 */}
      <ExcalidrawLazy excalidrawAPI={(api: ExcalidrawImperativeAPI) => setExcalidrawAPI(api)} />
    </div>
  );
}

// Separate inner component so the dynamic import boundary is clean
import dynamic from "next/dynamic";
const ExcalidrawLazy = dynamic(
  async () => (await import("@excalidraw/excalidraw")).Excalidraw,
  { ssr: false }
);
```

**Import the CSS once**, in your root layout or the file that first uses this component:
```tsx
import "@excalidraw/excalidraw/index.css";
```

**Make it read-only** (customer can't edit Max's drawing) — pass these props to the Excalidraw component:
```tsx
<ExcalidrawLazy
  excalidrawAPI={(api) => setExcalidrawAPI(api)}
  viewModeEnabled={true}
  zenModeEnabled={true}
/>
```

---

## STEP 3 — Defer loading until the call connects

Do NOT mount `PresentationCanvas` immediately on page load — this is a ~344 kB dependency and the avatar's connection should not compete with it for bandwidth/main-thread time on first load.

In your main call-view component:
```tsx
const [callConnected, setCallConnected] = useState(false);

// set callConnected = true once your existing Tavus/Daily connection 
// event fires (locate the existing "conversation started" or 
// "participant joined" handler already in the codebase)

return (
  <div style={{ display: "flex" }}>
    <AvatarView />
    {callConnected && <PresentationCanvas />}
  </div>
);
```

---

## STEP 4 — Wire granular tool calls for the progressive-drawing effect

This is the key requirement: **do not send one big "draw everything" tool call.** Define separate, granular tools so each sub-point in Max's presentation triggers its own drawing step.

### Tool definitions to add to the Tavus persona (via API, same pattern as the earlier `show_content` fix):

```json
{
  "type": "function",
  "function": {
    "name": "draw_grid_outline",
    "description": "Draw the empty 2x2 grid outline before filling it in",
    "parameters": { "type": "object", "properties": {} }
  }
},
{
  "type": "function",
  "function": {
    "name": "draw_grid_box",
    "description": "Fill in one box of the 2x2 grid with a label, one at a time as you talk about each point",
    "parameters": {
      "type": "object",
      "properties": {
        "quadrant": { "type": "integer", "enum": [1, 2, 3, 4] },
        "label": { "type": "string", "description": "Short text for this box, e.g. '6yr/75k Bumper to Bumper'" }
      },
      "required": ["quadrant", "label"]
    }
  }
},
{
  "type": "function",
  "function": {
    "name": "clear_canvas",
    "description": "Clear the drawing to start fresh",
    "parameters": { "type": "object", "properties": {} }
  }
}
```

### Frontend handler — locate your existing `conversation.tool_call` listener (already built for `show_content`) and extend it:

```tsx
function handleToolCall(event: any) {
  const { name, arguments: args } = event.properties;

  if (name === "draw_grid_outline") {
    const boxWidth = 240, boxHeight = 160, gap = 10, startX = 40, startY = 40;
    const outline = [
      { type: "rectangle", x: startX, y: startY, width: boxWidth, height: boxHeight },
      { type: "rectangle", x: startX + boxWidth + gap, y: startY, width: boxWidth, height: boxHeight },
      { type: "rectangle", x: startX, y: startY + boxHeight + gap, width: boxWidth, height: boxHeight },
      { type: "rectangle", x: startX + boxWidth + gap, y: startY + boxHeight + gap, width: boxWidth, height: boxHeight },
    ];
    (window as any).__addToCanvas(outline);
  }

  if (name === "draw_grid_box") {
    const { quadrant, label } = JSON.parse(args);
    const positions = {
      1: { x: 40, y: 40 }, 2: { x: 290, y: 40 },
      3: { x: 40, y: 210 }, 4: { x: 290, y: 210 },
    };
    const pos = positions[quadrant];
    (window as any).__addToCanvas([
      { type: "text", x: pos.x + 20, y: pos.y + 70, text: label, fontSize: 16 },
    ]);
  }

  if (name === "clear_canvas") {
    (window as any).__clearCanvas();
  }
}
```

*(Adjust to match your existing event-handling code style — this assumes the same `conversation.tool_call` → `app-message` pattern already working for `show_content`. Use `window` globals only as a quick bridge; refactor to proper React context/state if the codebase already has a cleaner pattern for cross-component communication.)*

---

## STEP 5 — Update Max's system prompt to actually call these tools progressively

Add to the existing system prompt (same file as the earlier presentation-trigger fix):

```
#Live Drawing (Four Square presentation)

When you begin Square 4 (the offer), draw the grid progressively as you talk 
— do NOT describe all four boxes and then draw the whole grid at once.

1. CALL draw_grid_outline as you say "let me show you how this breaks down"
2. As you explain the bumper-to-bumper warranty: CALL draw_grid_box with 
   quadrant 1 and the warranty terms as the label
3. As you explain the maintenance coverage: CALL draw_grid_box quadrant 2
4. As you explain tire & wheel: CALL draw_grid_box quadrant 3
5. As you explain GAP and the price: CALL draw_grid_box quadrant 4

Each tool call should happen AT THE MOMENT you start talking about that 
specific point — not before, not in a batch at the end. The customer should 
see the grid build up piece by piece as you explain each part, matching 
your pacing.

If starting a new presentation or the customer asks to see it again, 
CALL clear_canvas first.
```

---

## Explicit notes for Claude Code

- Confirm the exact `captureUpdate` API — recent Excalidraw versions use `CaptureUpdateAction.NEVER` as an enum import, not the string `"NEVER"` used as a placeholder above. Check the installed version's types (`@excalidraw/excalidraw/types`) and correct this before shipping.
- Confirm `viewModeEnabled` and `zenModeEnabled` are still the correct current prop names against the installed version's type definitions — don't assume without checking, since this library has had breaking API changes before (e.g., refs removed in v0.17, `commitToHistory` → `captureUpdate` in v0.18).
- Test that the CSS import path and dynamic-import pattern don't cause a build failure (`window is not defined`) — this is a common Next.js + Excalidraw SSR issue if the `ssr: false` boundary isn't set correctly.
- Verify bundle impact: confirm via `@next/bundle-analyzer` that Excalidraw lands in its own async chunk and does not increase the initial page load — this was the whole point of deferring it in Step 3.

## Definition of done

1. Excalidraw installs and runs with zero paid account/API key
2. Panel does not load until the avatar call is connected (verify via network tab — no Excalidraw chunk requested before connection)
3. A test call through the Four Square presentation shows the grid building progressively, one box at a time, not appearing all at once
4. Customer cannot edit or interact with the canvas (read-only confirmed)
5. `clear_canvas` works correctly if the presentation restarts