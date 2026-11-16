// Makes sure the SQLite driver can really open a database, and builds its
// native part when it cannot. Requiring the package is not enough of a check:
// the native part is only loaded when a database is opened.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);

function works() {
  try {
    const Database = require("better-sqlite3");
    new Database(":memory:").close();
    return true;
  } catch {
    return false;
  }
}

if (!works()) {
  const packageDir = dirname(require.resolve("better-sqlite3/package.json"));
  const result = spawnSync(process.execPath, ["--run", "install"], { cwd: packageDir, stdio: "inherit" });
  if (result.status !== 0 || !works()) {
    console.error(
      "The SQLite driver could not be installed. It downloads a ready-made binary, or builds one, " +
        "which needs a C++ compiler and Python. See https://github.com/WiseLibs/better-sqlite3 for the build tools.",
    );
    process.exit(result.status || 1);
  }
}
