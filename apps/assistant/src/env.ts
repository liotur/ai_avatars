import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Load `.env` files into `process.env` without overriding variables that are
 * already set. A file closer to `cwd` wins over one in a parent directory.
 */
export function loadEnvFiles(cwd = process.cwd()): void {
  const paths: string[] = [];
  let directory = resolve(cwd);
  for (let depth = 0; depth < 4; depth += 1) {
    paths.push(resolve(directory, ".env"));
    const parent = resolve(directory, "..");
    if (parent === directory) break;
    directory = parent;
  }

  const collected: Record<string, string> = {};
  for (const path of [...new Set(paths)].reverse()) {
    if (!existsSync(path)) continue;
    Object.assign(collected, parseEnv(readFileSync(path, "utf8")));
  }

  for (const [key, value] of Object.entries(collected)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function parseEnv(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const stripped = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const separator = stripped.indexOf("=");
    if (separator <= 0) continue;
    const key = stripped.slice(0, separator).trim();
    let value = stripped.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (key) result[key] = value;
  }
  return result;
}
