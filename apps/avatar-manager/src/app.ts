import { zAvatar, zAvatarList, zHealth } from "@avatars/contracts/avatar/zod";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { openDatabase } from "./db.js";
import {
  fieldErrorsFromIssues,
  nameTakenProblem,
  notFoundProblem,
  problem,
  validationFailed,
} from "./problem.js";
import { zAvatarCreateRequest, zAvatarIdParam, zAvatarUpdateRequest } from "./validation.js";

export type CreateAppOptions = {
  databasePath: string;
  corsOrigin: string;
  now?: () => Date;
};

function rejectInvalid(
  result: { success: boolean; error?: { issues?: ReadonlyArray<unknown> } },
  c: Context,
): Response | undefined {
  if (result.success) return undefined;
  return validationFailed(c, fieldErrorsFromIssues(result.error?.issues ?? []));
}

export function createApp(options: CreateAppOptions) {
  const store = openDatabase({
    databasePath: options.databasePath,
    ...(options.now ? { now: options.now } : {}),
  });
  const app = new Hono().basePath("/v1");

  app.use(
    "*",
    cors({
      origin: options.corsOrigin,
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type"],
    }),
  );

  app.notFound((c) =>
    problem(c, {
      type: "https://avatar.local/problems/not-found",
      title: "Not found",
      status: 404,
      detail: `No route for ${c.req.method} ${c.req.path}.`,
    }),
  );

  app.onError((error, c) => {
    if (error instanceof HTTPException && error.status === 400) {
      return validationFailed(c, [{ field: "/", message: "Request body must be valid JSON." }]);
    }
    console.error(error);
    return problem(c, {
      type: "https://avatar.local/problems/internal-error",
      title: "Internal error",
      status: 500,
      detail: "The request could not be completed.",
    });
  });

  app.get("/health", (c) => c.json(zHealth.parse({ status: "ok" })));

  app.get("/avatars", (c) => c.json(zAvatarList.parse({ items: store.list() })));

  app.post("/avatars", zValidator("json", zAvatarCreateRequest, rejectInvalid), (c) => {
    const body = c.req.valid("json");
    const created = store.create(body);
    if (!created.ok) return nameTakenProblem(c, created.name);
    c.header("Location", `/v1/avatars/${created.avatar.id}`);
    return c.json(zAvatar.parse(created.avatar), 201);
  });

  app.get("/avatars/:avatarId", zValidator("param", zAvatarIdParam, rejectInvalid), (c) => {
    const { avatarId } = c.req.valid("param");
    const avatar = store.findById(avatarId);
    if (!avatar) return notFoundProblem(c, avatarId);
    return c.json(zAvatar.parse(avatar));
  });

  app.patch(
    "/avatars/:avatarId",
    zValidator("param", zAvatarIdParam, rejectInvalid),
    zValidator("json", zAvatarUpdateRequest, rejectInvalid),
    (c) => {
      const { avatarId } = c.req.valid("param");
      const patch = c.req.valid("json");
      const updated = store.update(avatarId, patch);
      if (!updated.ok) {
        if (updated.reason === "not-found") return notFoundProblem(c, avatarId);
        return nameTakenProblem(c, updated.name);
      }
      return c.json(zAvatar.parse(updated.avatar));
    },
  );

  app.delete("/avatars/:avatarId", zValidator("param", zAvatarIdParam, rejectInvalid), (c) => {
    const { avatarId } = c.req.valid("param");
    if (!store.remove(avatarId)) return notFoundProblem(c, avatarId);
    return c.body(null, 204);
  });

  return {
    app,
    close: () => store.close(),
  };
}
