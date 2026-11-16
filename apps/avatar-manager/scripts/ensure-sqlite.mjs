import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);

try {
  require("better-sqlite3");
} catch {
  const packageDir = dirname(require.resolve("better-sqlite3/package.json"));
  const result = spawnSync(process.execPath, ["--run", "install"], {
    cwd: packageDir,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
