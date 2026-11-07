// Regenerates the client into a temp dir and fails if it differs from src/generated.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "jobproof-gen-"));
try {
  execFileSync("npx", ["openapi-ts", "-o", join(tmp, "generated")], { cwd: root, stdio: "pipe" });
  const diff = spawnSync("diff", ["-r", join(root, "src/generated"), join(tmp, "generated")], {
    encoding: "utf8",
  });
  if (diff.status !== 0) {
    console.error(diff.stdout || diff.stderr);
    console.error(
      "\ngen:check FAILED: shared/src/generated is out of date with api/openapi.yaml.\nRun `npm run gen` and commit the result.",
    );
    process.exit(1);
  }
  console.log("gen:check OK: shared/src/generated matches api/openapi.yaml");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
