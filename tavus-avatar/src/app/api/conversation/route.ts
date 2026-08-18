import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

import { NextResponse } from "next/server";

import { getActiveConversation, setActiveConversation } from "@/lib/active-conversations";
import { linkDealToConversation } from "@/lib/conversation-deals";
import { recordConversationEnded, recordConversationStarted } from "@/lib/conversation-usage";
import { formatDealContext, getDeal } from "@/lib/deal-context";
import { getCustomTavusLlmConfig } from "@/lib/tavus-custom-llms";
import { resolveConversationPersonaId } from "@/lib/tavus-personas";
import { getTavusConfig, getTavusErrorMessage, readResponsePayload, tavusFetch } from "@/lib/tavus-api";
import { attachVisitorCookie, getOrCreateVisitorId } from "@/lib/visitor";
import type { TavusConversationCreateResponse } from "@/types/tavus";

// Tavus knowledge base document for the AWS Summit Sydney schedule.
const AWS_SUMMIT_SCHEDULE_DOCUMENT_ID = "d4-c663569fd55d";
const DEFAULT_GREETING =
  "Hi, welcome to the AWS booth at Summit Sydney! I'm here to help you explore voice AI on AWS. Before we get started, what's your name and which company are you with? I can also show you diagrams, walk you through the Summit schedule, and answer questions about our tech stack.";

function getEventConfigName(): string {
  return process.env.EVENT_CONFIG || "aws-summit-mumbai-2026";
}

function getGreeting(): string {
  const eventDir = resolve(process.cwd(), `../prompts/${getEventConfigName()}`);
  const greetingPath = resolve(eventDir, "greeting.md");

  if (!existsSync(greetingPath)) {
    return DEFAULT_GREETING;
  }

  return readFileSync(greetingPath, "utf-8").trim();
}

function getDocumentIds(): string[] {
  // The AWS Summit schedule knowledge base only applies to the AWS booth events.
  return getEventConfigName().startsWith("aws-") ? [AWS_SUMMIT_SCHEDULE_DOCUMENT_ID] : [];
}

// Module-level singleton — survives across requests in the same Node process (kiosk/Docker).
// Only correct on a single persistent process; see active-conversations.ts for why this must
// not be deployed to a multi-instance or serverless host without a shared store.
declare global {
  var __conversationRateLimitByVisitor__: Map<string, number> | undefined;
}

function getRateLimitStore() {
  if (!globalThis.__conversationRateLimitByVisitor__) {
    globalThis.__conversationRateLimitByVisitor__ = new Map<string, number>();
  }

  return globalThis.__conversationRateLimitByVisitor__;
}

const RATE_LIMIT_MS = 60_000;

export async function POST(request: Request) {
  try {
    const { personaId: defaultPersonaId } = getTavusConfig();
    const params = new URL(request.url).searchParams;
    const llmName = params.get("llm");
    const personaId = params.get("persona") || defaultPersonaId;
    const { visitorId, isNew: isNewVisitor } = getOrCreateVisitorId(request);

    // Rate limiting — only enforced when DEMO_API_TOKEN is set (skipped in local dev).
    // Keyed per-visitor, not per shared auth token — every visitor who logs in with the
    // same DEMO_API_TOKEN would otherwise share a single rate-limit bucket.
    if (process.env.DEMO_API_TOKEN) {
      const rateLimitStore = getRateLimitStore();
      const last = rateLimitStore.get(visitorId);
      if (last !== undefined && Date.now() - last < RATE_LIMIT_MS) {
        const retryAfter = Math.ceil((RATE_LIMIT_MS - (Date.now() - last)) / 1000);
        return NextResponse.json(
          { error: `Please wait ${retryAfter} seconds before starting a new conversation.` },
          {
            headers: {
              "Cache-Control": "no-store",
              "Retry-After": String(retryAfter),
            },
            status: 429,
          },
        );
      }
    }

    if (llmName && !getCustomTavusLlmConfig(llmName)) {
      return NextResponse.json(
        {
          error: `Unknown Tavus LLM configuration "${llmName}".`,
        },
        {
          headers: {
            "Cache-Control": "no-store",
          },
          status: 400,
        },
      );
    }

    // End this same visitor's previously tracked conversation before creating a new one.
    // This cleans up orphans caused by browser crashes or failed pagehide requests —
    // scoped to this visitor only, so it never touches another customer's live call.
    const previousConversationId = getActiveConversation(visitorId);
    if (previousConversationId) {
      try {
        await tavusFetch(`/conversations/${previousConversationId}/end`, { method: "POST" });
        recordConversationEnded(previousConversationId);
      } catch {
        // Best-effort cleanup — do not block conversation creation.
      }
    }

    const conversationPersonaId = await resolveConversationPersonaId(personaId, llmName);
    const documentIds = getDocumentIds();

    // Optional real deal data (customer/vehicle/financing) from an external system —
    // see src/lib/deal-context.ts. Falls back to nothing (AI asks conversationally)
    // when no ?deal= param is given or the deal has expired.
    const dealId = params.get("deal");
    const dealContext = dealId ? getDeal(dealId) : undefined;
    const conversationalContext = dealContext ? formatDealContext(dealContext) : null;

    const response = await tavusFetch("/conversations", {
      method: "POST",
      body: JSON.stringify({
        persona_id: conversationPersonaId,
        ...(documentIds.length > 0 ? { document_ids: documentIds } : {}),
        ...(conversationalContext ? { conversational_context: conversationalContext } : {}),
        custom_greeting: getGreeting(),
        properties: {
          max_call_duration: 600,
          participant_left_timeout: 30,
          participant_absent_timeout: 600,
        },
      }),
    });

    const payload = await readResponsePayload<TavusConversationCreateResponse | { error?: string; message?: string }>(
      response,
    );

    if (!response.ok || !payload.json || !("conversation_id" in payload.json)) {
      return NextResponse.json(
        {
          error: getTavusErrorMessage(
            response,
            payload.json,
            "Failed to create Tavus conversation.",
          ),
        },
        {
          headers: {
            "Cache-Control": "no-store",
          },
          status: response.status || 500,
        },
      );
    }

    // Track the new conversation against this visitor and record the creation time for
    // rate limiting.
    setActiveConversation(visitorId, payload.json.conversation_id);
    recordConversationStarted(payload.json.conversation_id, conversationPersonaId);
    if (dealContext) {
      linkDealToConversation(payload.json.conversation_id, dealContext);
    }
    if (process.env.DEMO_API_TOKEN) {
      getRateLimitStore().set(visitorId, Date.now());
    }

    const successResponse = NextResponse.json(
      {
        conversation_id: payload.json.conversation_id,
        conversation_url: payload.json.conversation_url,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );

    if (isNewVisitor) {
      attachVisitorCookie(successResponse, visitorId);
    }

    return successResponse;
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected error while creating Tavus conversation.",
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
        status: 500,
      },
    );
  }
}
