import { zMessageRequest, zSessionId } from "@avatars/contracts/assistant/zod";
import type { Problem, Session } from "@avatars/contracts/assistant";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import type { $ZodIssue } from "zod/v4/core";
import { z } from "zod";

import type { AssistantModel } from "./autox.js";
import { resolveAvatar } from "./loop.js";
import type { AvatarMcp } from "./mcp.js";
import { HttpProblem, llmFailed, problem, sessionNotFound, validationFailed, validationFailedFromZod } from "./problems.js";
import { redact } from "./redact.js";

const messageRequestSchema = zMessageRequest.strict();
const sessionParamSchema = z.object({ sessionId: zSessionId });

export type CreateAppOptions = {
  mcp: AvatarMcp;
  model: AssistantModel;
  corsOrigin?: string;
  sessions?: Map<string, Session>;
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
  const sessions = options.sessions ?? new Map<string, Session>();
  const corsOrigin = options.corsOrigin ?? "http://localhost:5173";
  const now = options.now ?? (() => new Date());
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

  app.post("/sessions", (c) => {
    const session: Session = {
      id: crypto.randomUUID(),
      createdAt: now().toISOString(),
    };
    sessions.set(session.id, session);
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

      const body = c.req.valid("json");
      let resolved;
      try {
        resolved = await resolveAvatar({
          content: body.content,
          ...(body.avatarId ? { avatarId: body.avatarId } : {}),
          mcp: options.mcp,
          model: options.model,
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
        try {
          for await (const text of options.model.streamAnswer({
            system: resolved.system,
            prompt: body.content,
            signal: disconnected.signal,
          })) {
            if (text.length === 0) continue;
            await stream.writeSSE({ event: "delta", data: JSON.stringify({ text }) });
          }
          await stream.writeSSE({ event: "done", data: JSON.stringify(done) });
        } catch (error) {
          if (disconnected.signal.aborted) return;
          const detail = redact(
            error instanceof Error ? error.message : "The answer stream failed.",
            options.apiKey,
          );
          const failure: Problem = { ...answer, detail };
          await stream.writeSSE({ event: "error", data: JSON.stringify(failure) });
        }
      });
    },
  );

  return app;
}
