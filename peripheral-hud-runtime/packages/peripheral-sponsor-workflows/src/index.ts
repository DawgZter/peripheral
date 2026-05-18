import {
  assertWidget,
  cleanText,
  type AgentEvent,
  type PeripheralWidget,
  type SurfaceKind,
} from "../../peripheral-protocol/src/index.js";
import { SPONSOR_IDS, buildApprovalEvent, sourceFor, sponsorIntegrations, type SponsorId } from "../../peripheral-integrations/src/index.js";

export type SponsorWorkflowStep = {
  id: string;
  sponsor: SponsorId;
  event: string;
  title: string;
  summary: string;
  surface: SurfaceKind;
  risk: "low" | "medium" | "high";
  approvalRequired: boolean;
  phoneRuntimeRule: string;
};

export type SponsorWorkflow = {
  id: string;
  sponsor: SponsorId;
  name: string;
  intent: string;
  trigger: string;
  env: string[];
  steps: SponsorWorkflowStep[];
  outputs: Array<"SurfaceCommand" | "AgentEvent" | "UserDecision" | "AuditLog" | "PeripheralWidget">;
  reviewCommand: string;
};

export type SponsorWorkflowDossier = {
  schema: "peripheral-sponsor-workflows-v1";
  generatedAt: string;
  thesis: string;
  workflows: SponsorWorkflow[];
  widgets: PeripheralWidget[];
  approvalEvents: AgentEvent[];
};

export function buildSponsorWorkflows(): SponsorWorkflow[] {
  return sponsorIntegrations.map((sponsor) => workflowForSponsor(sponsor.id));
}

export function workflowForSponsor(id: string): SponsorWorkflow {
  if (!isSponsorId(id)) {
    throw new Error("Unknown sponsor workflow '" + id + "'. Use one of: " + SPONSOR_IDS.join(", "));
  }
  switch (id) {
    case "agentphone":
      return workflow(
        id,
        "Call handoff loop",
        "Convert call state, transcript snippets, and handoff requests into wearer-safe Agent Mode cards.",
        "phone agent call state changes",
        [
          step(id, "call_connected", "Call Connected", "Show that the phone agent is live and the wearer can take over.", "glance", "low", false),
          step(id, "human_takeover_requested", "Take Over?", "Escalate spoken handoff with visible choices and audit trail.", "fullscreen", "medium", true),
        ],
      );
    case "stripe":
      return workflow(
        id,
        "Payment approval loop",
        "Show receipts as glances while gating card holds, setup intents, and high-risk payment actions.",
        "payment or setup intent status update",
        [
          step(id, "receipt_available", "Receipt Ready", "Show amount, merchant, and status after an agent purchase.", "glance", "low", false),
          step(id, "payment_intent_requires_action", "Approve Payment?", "Require phone-visible approval before a charge or hold continues.", "fullscreen", "high", true),
        ],
      );
    case "supermemory":
      return workflow(
        id,
        "Memory recall loop",
        "Let agents retrieve context for the HUD while requiring approval before storing sensitive facts.",
        "memory search or save request",
        [
          step(id, "memory_search_result", "Context Recall", "Condense retrieved context into a few wearer-safe bullets.", "glance", "low", false),
          step(id, "memory_save_requested", "Save Memory?", "Ask before making a preference or personal fact durable.", "fullscreen", "medium", true),
        ],
      );
    case "agentmail":
      return workflow(
        id,
        "Inbox and draft loop",
        "Surface urgent mail and verification snippets without allowing silent sends.",
        "mailbox event or draft completion",
        [
          step(id, "mail_received", "Inbox Triage", "Show the top urgent thread and unread count in Agent Mode.", "tiny_hud", "low", false),
          step(id, "draft_ready", "Send Draft?", "Display concise outbound copy and require confirmation before sending.", "fullscreen", "medium", true),
        ],
      );
    case "browser_use":
      return workflow(
        id,
        "Browser proof loop",
        "Translate browser automation progress into semantic proof cards and block sensitive submissions.",
        "browser step, wait, result, or submit action",
        [
          step(id, "browser_step", "Browser Step", "Show page title, action, and next wait state.", "glance", "low", false),
          step(id, "browser_submit_requested", "Submit Form?", "Escalate authenticated submissions and account changes.", "fullscreen", "high", true),
        ],
      );
    case "sponge":
      return workflow(
        id,
        "Signal digest loop",
        "Compress call, browser, mail, memory, and terminal noise into a single wearer-safe summary.",
        "context cluster or summary event",
        [
          step(id, "summary_ready", "Signal Digest", "Render grouped signals as a compact Agent Mode summary.", "glance", "low", false),
          step(id, "context_clustered", "Pin Digest?", "Ask before pinning a digest across sessions.", "pinned", "medium", true),
        ],
      );
    case "gemini":
      return workflow(
        id,
        "Broker reasoning loop",
        "Use multimodal and routing suggestions behind deterministic lease, focus, and approval policy.",
        "broker summary or route decision",
        [
          step(id, "broker_summary", "Broker Summary", "Summarize why an interruption is worth showing.", "glance", "low", false),
          step(id, "route_decision", "Route Voice", "Explain whether voice input targets a focused card, named agent, or broker.", "tiny_hud", "low", false),
        ],
      );
  }
}

export function buildSponsorWorkflowDossier(now = new Date()): SponsorWorkflowDossier {
  const workflows = buildSponsorWorkflows();
  const approvalEvents = workflows.flatMap((workflowItem) =>
    workflowItem.steps
      .filter((workflowStep) => workflowStep.approvalRequired)
      .map((workflowStep) => buildApprovalEvent(workflowStep.sponsor, workflowStep.id, workflowStep.title, workflowStep.summary, now, workflowStep.risk)),
  );
  return {
    schema: "peripheral-sponsor-workflows-v1",
    generatedAt: now.toISOString(),
    thesis: "Sponsor integrations enter as events, become broker-normalized AgentEvents, then render as semantic HUD widgets through the phone-owned surface runtime.",
    workflows,
    widgets: buildSponsorWorkflowWidgets(now),
    approvalEvents,
  };
}

export function buildSponsorWorkflowWidgets(now = new Date()): PeripheralWidget[] {
  const workflows = buildSponsorWorkflows();
  return [
    assertWidget({
      id: "sponsor-workflow-overview",
      type: "table",
      title: "Sponsor Workflows",
      status: String(workflows.length) + " LOOPS",
      columns: ["Sponsor", "Trigger", "Gate"],
      rows: workflows.map((workflowItem) => ({
        Sponsor: sourceFor(workflowItem.sponsor).label,
        Trigger: cleanText(workflowItem.trigger, 26),
        Gate: String(workflowItem.steps.filter((workflowStep) => workflowStep.approvalRequired).length),
      })),
      footer: "Connected broker review",
      source: "peripheral-sponsor-workflows",
      created_at: now.toISOString(),
    }),
    assertWidget({
      id: "sponsor-workflow-gates",
      type: "checklist",
      title: "Approval Gates",
      status: "POLICY",
      items: workflows.flatMap((workflowItem) =>
        workflowItem.steps
          .filter((workflowStep) => workflowStep.approvalRequired)
          .slice(0, 1)
          .map((workflowStep) => ({
            label: sourceFor(workflowItem.sponsor).label + ": " + workflowStep.title,
            checked: true,
            status: workflowStep.risk,
          })),
      ),
      footer: "No silent sends, stores, or charges",
      source: "peripheral-sponsor-workflows",
      created_at: now.toISOString(),
    }),
  ];
}

function workflow(
  sponsor: SponsorId,
  name: string,
  intent: string,
  trigger: string,
  steps: SponsorWorkflowStep[],
): SponsorWorkflow {
  const info = sponsorIntegrations.find((item) => item.id === sponsor);
  return {
    id: sponsor + "-workflow",
    sponsor,
    name,
    intent,
    trigger,
    env: info?.env || [],
    steps,
    outputs: ["AgentEvent", "SurfaceCommand", "PeripheralWidget", "UserDecision", "AuditLog"],
    reviewCommand: "npm run peripheralctl -- sponsor-workflows workflow " + sponsor + " --json",
  };
}

function step(
  sponsor: SponsorId,
  event: string,
  title: string,
  summary: string,
  surface: SurfaceKind,
  risk: SponsorWorkflowStep["risk"],
  approvalRequired: boolean,
): SponsorWorkflowStep {
  return {
    id: sponsor + "-" + event.replace(/[^a-z0-9]+/gi, "-").toLowerCase(),
    sponsor,
    event,
    title,
    summary,
    surface,
    risk,
    approvalRequired,
    phoneRuntimeRule: approvalRequired ? "focused card wins input until resolved" : "glance can yield to higher priority leases",
  };
}

function isSponsorId(value: string): value is SponsorId {
  return SPONSOR_IDS.includes(value as SponsorId);
}
