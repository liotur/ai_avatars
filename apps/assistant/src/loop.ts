import type { Avatar, AvatarCreate } from "@avatars/contracts/avatar";
import type { AvatarRef, Selection } from "@avatars/contracts/assistant";

import { avatarDraftSchema, type Classification } from "./classify.js";
import { historyForClassifier, type Turn } from "./conversation.js";
import {
  AvatarNotFoundError,
  AvatarRejectedError,
  McpCallError,
  type AvatarMcp,
  type AvatarSummary,
} from "./mcp.js";
import { ClassificationRejectedError, describeIssues, LlmCallError, type AssistantModel } from "./model.js";
import { avatarNotFoundProblem, HttpProblem, llmFailed, mcpFailed } from "./problems.js";
import { buildAvatarSystemPrompt } from "./prompts.js";
import { redact } from "./redact.js";

export type ResolvedAvatar = {
  avatar: Avatar;
  selection: Selection;
  system: string;
};

const MAX_ATTEMPTS = 2;

export async function resolveAvatar(input: {
  content: string;
  avatarId?: string;
  /** The earlier turns of this chat, oldest first. */
  history?: readonly Turn[];
  mcp: AvatarMcp;
  model: AssistantModel;
  secret?: string;
}): Promise<ResolvedAvatar> {
  const history = input.history ?? [];
  const recent = historyForClassifier(history);
  // The answer is told when another avatar answered earlier in the same chat.
  const systemFor = (avatar: Avatar) =>
    buildAvatarSystemPrompt(avatar, { otherStances: history.some((turn) => turn.avatarId !== avatar.id) });

  let summaries: AvatarSummary[];
  try {
    summaries = await input.mcp.listAvatars();
  } catch (error) {
    throw toHttp(error, "list_avatars", input.secret);
  }

  if (input.avatarId) {
    if (!summaries.some((avatar) => avatar.id === input.avatarId)) {
      throw avatarNotFoundProblem(input.avatarId);
    }
    const avatar = await loadAvatar(input.mcp, input.avatarId, input.secret);
    return {
      avatar,
      selection: { mode: "requested" },
      system: systemFor(avatar),
    };
  }

  let feedback: string | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let decision: Classification;
    try {
      decision = await input.model.classify({
        content: input.content,
        summaries,
        ...(recent.length > 0 ? { history: recent } : {}),
        ...(feedback ? { feedback } : {}),
      });
    } catch (error) {
      if (error instanceof ClassificationRejectedError) {
        feedback = redact(error.message, input.secret);
        continue;
      }
      throw toHttp(error, "classify", input.secret);
    }

    if (decision.decision === "choose") {
      if (!summaries.some((avatar) => avatar.id === decision.avatarId)) {
        feedback = `No avatar with id ${decision.avatarId}. Choose an id from the list or draft a new avatar.`;
        continue;
      }
      try {
        const avatar = await loadAvatar(input.mcp, decision.avatarId, input.secret);
        return {
          avatar,
          selection: { mode: "chosen", reason: decision.reason },
          system: systemFor(avatar),
        };
      } catch (error) {
        if (error instanceof AvatarNotFoundError || (error instanceof HttpProblem && error.problem.status === 404)) {
          feedback = `No avatar with id ${decision.avatarId}. Choose an id from the list or draft a new avatar.`;
          continue;
        }
        throw error;
      }
    }

    const checked = avatarDraftSchema.safeParse(decision.draft);
    if (!checked.success) {
      feedback = `The draft is not usable. ${describeIssues(checked.error.issues)}`;
      continue;
    }
    const draft = checked.data;
    const body: AvatarCreate = {
      name: draft.name,
      description: draft.description,
      perspective: draft.perspective,
      voice: draft.voice,
      caresAbout: draft.caresAbout,
      ignores: draft.ignores,
      useWhen: draft.useWhen,
      intensity: draft.intensity,
      createdBy: "assistant",
    };
    try {
      const created = await input.mcp.createAvatar(body);
      const avatar = await loadAvatar(input.mcp, created.id, input.secret);
      return {
        avatar,
        selection: { mode: "created", reason: decision.reason },
        system: systemFor(avatar),
      };
    } catch (error) {
      if (error instanceof AvatarRejectedError && attempt < MAX_ATTEMPTS - 1) {
        feedback = `create_avatar rejected the draft (${error.status}): ${error.message}`;
        continue;
      }
      if (error instanceof AvatarRejectedError) {
        throw llmFailed(
          redact(
            `The model returned an unusable classification after one retry. ${error.message}`,
            input.secret,
          ),
        );
      }
      throw toHttp(error, "create_avatar", input.secret);
    }
  }

  throw llmFailed(
    redact(
      `The model returned an unusable classification after one retry. ${feedback ?? "Choose an existing avatar or draft a new one."}`,
      input.secret,
    ),
  );
}

async function loadAvatar(mcp: AvatarMcp, avatarId: string, secret: string | undefined): Promise<Avatar> {
  try {
    return await mcp.getAvatar(avatarId);
  } catch (error) {
    if (error instanceof AvatarNotFoundError) throw avatarNotFoundProblem(avatarId);
    throw toHttp(error, "get_avatar", secret);
  }
}

function toHttp(error: unknown, tool: string, secret: string | undefined): HttpProblem {
  if (isHttpProblem(error)) return error;
  const message = error instanceof Error ? error.message : "The request could not be completed.";
  const detail = redact(message, secret);
  if (error instanceof LlmCallError || tool === "classify") return llmFailed(detail);
  if (error instanceof McpCallError || error instanceof Error) {
    const prefix = error instanceof McpCallError ? error.tool : tool;
    return mcpFailed(detail.startsWith(prefix) ? detail : `${prefix} failed. ${detail}`);
  }
  return mcpFailed(`${tool} failed.`);
}

function isHttpProblem(error: unknown): error is HttpProblem {
  return error instanceof HttpProblem;
}
