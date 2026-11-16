import { zMessageRequest, zSessionId } from "@avatars/contracts/assistant/zod";
import type { AssistantStatus, Problem, Session } from "@avatars/contracts/assistant";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import type { $ZodIssue } from "zod/v4/core";
import { z } from "zod";

import { historyForAnswer, historyForClassifier, SessionStore } from "./conversation.js";
import { adviceFor, failedChecks } from "./evaluate.js";
import { resolveAvatar } from "./loop.js";
import type { AvatarMcp } from "./mcp.js";
import type { AssistantModel } from "./model.js";
import {
  HttpProblem,
  llmFailed,
  llmNotConfigured,
  problem,
  sessionNotFound,
  validationFailed,
  validationFailedFromZod,
} from "./problems.js";
import { revisionPrompt } from "./prompts.js";
import { redact } from "./redact.js";

const messageRequestSchema = zMessageRequest.strict();
const sessionParamSchema = z.object({ sessionId: zSessionId });

export type CreateAppOptions = {
  mcp: AvatarMcp;
  /** Left out when no language model is configured. Messages are then refused with 503. */
  model?: AssistantModel;
  /** What `GET /assistant` reports. Defaults to ready when a model is given. */
  status?: AssistantStatus;
  corsOrigin?: string;
  /**
   * Check each draft before it counts as the answer, and have the avatar
   * rewrite a draft that fails. The draft is streamed as work in progress, and
   * the answer follows once the check is done. Off unless set.
   */
  checkAnswers?: boolean;
  sessions?: SessionStore;
  apiKey?: string;
  now?: () => Date;
};

function rejectInvalid(
  result: { success: true } | { success: false; error: { issues: readonly $ZodIssue[] } },
  c: Context,
) {
  if (!result.success) return validationFailedFromZod(c, result.error);
}

export function createApp(options: CreateAppOptions) {
  const sessions = options.sessions ?? new SessionStore();
  const corsOrigin = options.corsOrigin ?? "http://localhost:5173";
  const now = options.now ?? (() => new Date());
  const { model } = options;
  const status: AssistantStatus =
    options.status ??
    (model ? { ready: true } : { ready: false, detail: "No language model is configured." });
  const app = new Hono().basePath("/v1");

  app.use(
    "*",
    cors({
      origin: corsOrigin,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
      exposeHeaders: ["Location"],
    }),
  );

  app.onError((error, c) => {
    if (error instanceof HttpProblem) return problem(c, error.problem);
    if (error instanceof HTTPException && error.status === 400) {
      return validationFailed(c, [{ field: "/", message: "Request body must be valid JSON." }]);
    }
    const detail = redact(
      error instanceof Error ? error.message : "The request could not be completed.",
      options.apiKey,
    );
    console.error(detail);
    return problem(c, llmFailed(detail || "The request could not be completed.").problem);
  });

  app.notFound((c) =>
    problem(c, {
      type: "https://assistant.local/problems/not-found",
      title: "Not found",
      status: 404,
      detail: `No route for ${c.req.method} ${new URL(c.req.url).pathname}.`,
    }),
  );

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/assistant", (c) => c.json(status));

  app.post("/sessions", (c) => {
    const session: Session = {
      id: crypto.randomUUID(),
      createdAt: now().toISOString(),
    };
    sessions.create(session);
    c.header("Location", `/v1/sessions/${session.id}`);
    return c.json(session, 201);
  });

  app.post(
    "/sessions/:sessionId/messages",
    zValidator("param", sessionParamSchema, rejectInvalid),
    zValidator("json", messageRequestSchema, rejectInvalid),
    async (c) => {
      const { sessionId } = c.req.valid("param");
      if (!sessions.has(sessionId)) return sessionNotFound(c, sessionId);
      if (!model) {
        return problem(c, llmNotConfigured(status.detail ?? "No language model is configured.").problem);
      }

      const body = c.req.valid("json");
      // A copy, so a turn recorded while this message is in flight does not change what it was shown.
      const history = [...sessions.turns(sessionId)];
      let resolved;
      try {
        resolved = await resolveAvatar({
          content: body.content,
          history,
          ...(body.avatarId ? { avatarId: body.avatarId } : {}),
          mcp: options.mcp,
          model,
          ...(options.apiKey ? { secret: options.apiKey } : {}),
        });
      } catch (error) {
        if (error instanceof HttpProblem) return problem(c, error.problem);
        throw error;
      }

      const answer: Problem & { id?: string } = {
        type: "https://assistant.local/problems/llm-failed",
        title: "Language model call failed",
        status: 502,
      };
      const done = {
        id: crypto.randomUUID(),
        createdAt: now().toISOString(),
      };

      return streamSSE(c, async (stream) => {
        const disconnected = new AbortController();
        stream.onAbort(() => disconnected.abort());
        let answered = "";
        // What the person saw is remembered, even when the answer was stopped or failed part-way.
        let remembered = false;
        const remember = () => {
          if (remembered || !answered) return;
          remembered = true;
          sessions.addTurn(sessionId, {
            question: body.content,
            answer: answered,
            avatarId: resolved.avatar.id,
            avatarName: resolved.avatar.name,
          });
        };
        await stream.writeSSE({
          event: "avatar",
          data: JSON.stringify({
            avatar: {
              id: resolved.avatar.id,
              name: resolved.avatar.name,
              description: resolved.avatar.description,
              intensity: resolved.avatar.intensity,
              createdBy: resolved.avatar.createdBy,
            },
            selection: resolved.selection,
          }),
        });
        const send = (event: string, data: unknown) => stream.writeSSE({ event, data: JSON.stringify(data) });
        const earlier = historyForAnswer(history);
        /** Writes an answer to the person as it is produced, and keeps what was sent. */
        const streamToPerson = async (input: { prompt: string; history: typeof earlier }) => {
          for await (const text of model.streamAnswer({
            system: resolved.system,
            prompt: input.prompt,
            history: input.history,
            signal: disconnected.signal,
          })) {
            if (text.length === 0) continue;
            await send("delta", { text });
            answered += text;
          }
        };

        try {
          if (!options.checkAnswers) {
            await streamToPerson({ prompt: body.content, history: earlier });
          } else {
            // The draft is shown as work in progress while it is written. It becomes
            // the answer only once it has been checked.
            await send("stage", { stage: "drafting" });
            let draft = "";
            for await (const text of model.streamAnswer({
              system: resolved.system,
              prompt: body.content,
              history: earlier,
              signal: disconnected.signal,
            })) {
              if (text.length === 0) continue;
              await send("draft", { text });
              draft += text;
            }

            await send("stage", { stage: "checking" });
            let advice: string | undefined;
            try {
              const evaluation = await model.evaluate({
                avatar: resolved.avatar,
                content: body.content,
                history: historyForClassifier(history),
                draft,
                signal: disconnected.signal,
              });
              const failed = failedChecks(evaluation);
              if (failed.length === 0) {
                await send("evaluation", { verdict: "passed", failed });
              } else {
                advice = adviceFor(evaluation);
                await send("evaluation", { verdict: "revised", failed, note: advice });
              }
            } catch (error) {
              if (disconnected.signal.aborted) throw error;
              // The check is a quality step. When it cannot run, the draft is shown and labelled as unchecked.
              console.error(redact(error instanceof Error ? error.message : "The answer check failed.", options.apiKey));
              await send("evaluation", {
                verdict: "skipped",
                failed: [],
                note: "The check could not be run, so this answer is shown unchecked.",
              });
            }

            if (advice === undefined) {
              if (draft.length > 0) await send("delta", { text: draft });
              answered = draft;
            } else {
              // One rewrite, shown as it is written. It is not checked again.
              await send("stage", { stage: "revising" });
              await streamToPerson({
                prompt: revisionPrompt(advice),
                history: [...earlier, { role: "user", content: body.content }, { role: "assistant", content: draft }],
              });
            }
          }
          remember();
          await send("done", done);
        } catch (error) {
          remember();
          if (disconnected.signal.aborted) return;
          const detail = redact(
            error instanceof Error ? error.message : "The answer stream failed.",
            options.apiKey,
          );
          const failure: Problem = { ...answer, detail };
          await send("error", failure);
        }
      });
    },
  );

  return app;
}
