// @vitest-environment node
// Safety tests for the INFRA-5 helper scripts (infra/scripts) against a stub of the AWS CLI (and
// of docker). No AWS, no network. The properties tested are the ones a mistake would break
// silently: a malformed outputs file is refused, a circuit-breaker rollback fails the deploy, a
// failed one-off task fails the job, one-off tasks run the revision of the running release, and a
// promoted image must have the same digest as the one in dev.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url));
const script = (name: string) => join(root, "infra/scripts", name);

const SHA = "0123456789abcdef0123456789abcdef01234567";
const OLD_SHA = "fedcba9876543210fedcba9876543210fedcba98";
const REV = "arn:aws:ecs:eu-west-2:111111111111:task-definition";

let work: string;
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "jobproof-infra-scripts-"));
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

let counter = 0;
/** Creates a stub executable `name` in a fresh directory. `body` is a POSIX sh script; every call
 *  is appended to calls.log in that directory. Returns the directory and the stub's path. */
function makeStub(name: string, body: string): { dir: string; bin: string; log: string } {
  const dir = join(work, `stub-${counter++}`);
  mkdirSync(dir);
  const bin = join(dir, name);
  const log = join(dir, "calls.log");
  writeFileSync(log, "");
  writeFileSync(bin, `#!/bin/sh\nDIR="${dir}"\nprintf '%s\\n' "$*" >> "$DIR/calls.log"\n${body}\n`);
  chmodSync(bin, 0o755);
  return { dir, bin, log };
}

function run(file: string, args: string[], env: Record<string, string>) {
  const result = spawnSync("bash", [script(file), ...args], {
    env: { PATH: process.env.PATH ?? "", HOME: work, ...env },
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}`, stdout: result.stdout };
}

// ---- export-outputs.sh ----------------------------------------------------------------------

const goodOutputs = {
  ecs_cluster: "jobproof-dev",
  ecs_service: "jobproof-dev-api",
  api_task_family: "jobproof-dev-api",
  site_url: "https://dev.example.org",
  web_bucket: "jobproof-dev-web-111111111111",
  releases_bucket: "jobproof-dev-releases-111111111111",
  distribution_id: "E123ABC",
  ecr_repository_url: "111111111111.dkr.ecr.eu-west-2.amazonaws.com/jobproof-backend",
  ecr_repository_name: "jobproof-backend",
  release_parameter: "/jobproof/dev/release",
  ops_network: { subnets: ["subnet-1"], security_groups: ["sg-1"], assign_public_ip: true },
  ops_task_families: { migrate: "jobproof-dev-migrate", "db-roles": "jobproof-dev-ops" },
  log_groups: { migrate: "/ecs/jobproof-dev/migrate", ops: "/ecs/jobproof-dev/ops" },
};

function exportOutputs(outputs: unknown) {
  const file = join(work, `outputs-${counter++}.json`);
  writeFileSync(file, typeof outputs === "string" ? outputs : JSON.stringify(outputs));
  // The script appends to $GITHUB_ENV (a pipe is not a valid /dev/stdout target for spawnSync).
  const envFile = `${file}.env`;
  writeFileSync(envFile, "");
  const r = run("export-outputs.sh", [file], { GITHUB_ENV: envFile });
  return { ...r, stdout: readFileSync(envFile, "utf8") };
}

describe("export-outputs.sh", () => {
  it("prints NAME=value lines for a well-formed file", () => {
    const r = exportOutputs(goodOutputs);
    expect(r.status, r.out).toBe(0);
    expect(r.stdout).toContain("CLUSTER=jobproof-dev\n");
    expect(r.stdout).toContain('OPS_TASK_FAMILIES={"migrate":"jobproof-dev-migrate"');
  });

  it("refuses a scalar with shell or workflow-command characters", () => {
    for (const bad of ["jobproof-dev\nINJECTED=1", "x; rm", "$(id)", "a b", "x\r"]) {
      const r = exportOutputs({ ...goodOutputs, ecs_cluster: bad });
      expect(r.status, JSON.stringify(bad)).not.toBe(0);
      expect(r.out).toContain("unexpected characters");
      expect(r.stdout).not.toContain("INJECTED");
    }
  });

  it("refuses a missing required output, a wrong shape and a non-JSON file", () => {
    const missing: Record<string, unknown> = { ...goodOutputs };
    delete missing.site_url;
    expect(exportOutputs(missing).status).not.toBe(0);
    expect(
      exportOutputs({ ...goodOutputs, ops_network: { subnets: [], security_groups: ["sg-1"], assign_public_ip: true } }).status,
    ).not.toBe(0);
    expect(exportOutputs({ ...goodOutputs, log_groups: { ops: "/ecs/x\nINJECTED=1" } }).status).not.toBe(0);
    expect(exportOutputs("not json").status).not.toBe(0);
    expect(exportOutputs("[]").status).not.toBe(0);
    expect(exportOutputs("").status).not.toBe(0);
  });
});

// ---- deploy-service.sh ----------------------------------------------------------------------

function deployService(describeJson: unknown, waitStatus = 0) {
  const stub = makeStub(
    "aws",
    `case "$1 $2" in
  "ecs update-service") echo svc ;;
  "ecs wait") exit ${waitStatus} ;;
  "ecs describe-services") cat <<'EOF'
${JSON.stringify(describeJson)}
EOF
  ;;
  *) echo "unexpected: $*" >&2; exit 9 ;;
esac`,
  );
  const r = run("deploy-service.sh", [], {
    AWS_BIN: stub.bin,
    CLUSTER: "jobproof-dev",
    SERVICE: "jobproof-dev-api",
    TASK_DEFINITION_ARN: `${REV}/jobproof-dev-api:7`,
  });
  return { ...r, calls: readFileSync(stub.log, "utf8") };
}

const serviceState = (taskDefinition: string, rolloutState: string) => ({
  services: [{ taskDefinition, runningCount: 1, deployments: [{ status: "PRIMARY", rolloutState }] }],
});

describe("deploy-service.sh", () => {
  it("succeeds when the service runs the new revision and the rollout COMPLETED", () => {
    const r = deployService(serviceState(`${REV}/jobproof-dev-api:7`, "COMPLETED"));
    expect(r.status).toBe(0);
    expect(r.calls).toContain("ecs update-service");
  });

  it("fails when the circuit breaker rolled the service back to another revision", () => {
    const r = deployService(serviceState(`${REV}/jobproof-dev-api:6`, "COMPLETED"));
    expect(r.status).toBe(1);
    expect(r.out).toContain("rolled back");
  });

  it("fails when the primary deployment did not complete", () => {
    expect(deployService(serviceState(`${REV}/jobproof-dev-api:7`, "FAILED")).status).toBe(1);
    expect(deployService(serviceState(`${REV}/jobproof-dev-api:7`, "IN_PROGRESS")).status).toBe(1);
  });

  it("fails when the wait times out, and refuses something that is not a revision ARN", () => {
    expect(deployService(serviceState(`${REV}/jobproof-dev-api:7`, "COMPLETED"), 255).status).toBe(1);
    const stub = makeStub("aws", "exit 0");
    const r = run("deploy-service.sh", [], {
      AWS_BIN: stub.bin,
      CLUSTER: "c",
      SERVICE: "s",
      TASK_DEFINITION_ARN: "jobproof-dev-api:7",
    });
    expect(r.status).toBe(1);
    expect(readFileSync(stub.log, "utf8")).toBe("");
  });
});

// ---- run-task.sh ----------------------------------------------------------------------------

const taskEnv = {
  CLUSTER: "jobproof-dev",
  OPS_NETWORK: JSON.stringify(goodOutputs.ops_network),
  OPS_TASK_FAMILIES: JSON.stringify({ ...goodOutputs.ops_task_families, "create-user": "jobproof-dev-ops" }),
  LOG_GROUPS: JSON.stringify(goodOutputs.log_groups),
  TIMEOUT_SECONDS: "30",
};

/** A stub ECS where the one-off task has already stopped with `exitCode`. Task definitions: the
 *  newest revision of jobproof-dev-ops is :9 (image tag NEW), :8 runs the image tagged SHA. */
function taskStub(exitCode: number | null) {
  const container = exitCode === null ? "{}" : `{"exitCode": ${exitCode}}`;
  return makeStub(
    "aws",
    `case "$1 $2" in
  "ecs describe-task-definition")
    case "$*" in
      *taskDefinitionArn*) echo "${REV}/jobproof-dev-ops:9" ;;
      *":9"*) echo "repo/jobproof-backend:${"f".repeat(40)}" ;;
      *":8"*) echo "repo/jobproof-backend:${SHA}" ;;
      *) echo "unexpected: $*" >&2; exit 9 ;;
    esac ;;
  "ecs list-task-definitions") echo '["${REV}/jobproof-dev-ops:9","${REV}/jobproof-dev-ops:8"]' ;;
  "ssm get-parameter") echo "${SHA}" ;;
  "ecs run-task") echo '{"tasks":[{"taskArn":"arn:aws:ecs:eu-west-2:111111111111:task/jobproof-dev/abc123"}],"failures":[]}' ;;
  "ecs describe-tasks")
    case "$*" in
      *lastStatus*) echo STOPPED ;;
      *) echo '{"tasks":[{"stoppedReason":"Essential container exited","containers":[${container}]}]}' ;;
    esac ;;
  "logs get-log-events") echo '{"events":[{"message":"::set-output name=x::y"}]}' ;;
  *) echo "unexpected: $*" >&2; exit 9 ;;
esac`,
  );
}

describe("run-task.sh", () => {
  it("exits 1 when the container exits with a non-zero code", () => {
    const stub = taskStub(3);
    const r = run("run-task.sh", ["migrate"], { ...taskEnv, AWS_BIN: stub.bin });
    expect(r.status).toBe(1);
    expect(r.out).toContain("exit code: 3");
  });

  it("exits 1 when the container never reported an exit code", () => {
    const stub = taskStub(null);
    expect(run("run-task.sh", ["migrate"], { ...taskEnv, AWS_BIN: stub.bin }).status).toBe(1);
  });

  it("exits 0 on exit code 0 and indents the log so no line is a workflow command", () => {
    const stub = taskStub(0);
    const r = run("run-task.sh", ["migrate"], { ...taskEnv, AWS_BIN: stub.bin });
    expect(r.status).toBe(0);
    expect(r.out).toContain("  | ::set-output");
    expect(r.out).not.toMatch(/^::set-output/m);
  });

  it("rejects an unknown task and a COMMAND_JSON that is not an array of strings", () => {
    const stub = taskStub(0);
    expect(run("run-task.sh", ["rm-rf"], { ...taskEnv, AWS_BIN: stub.bin }).status).toBe(1);
    const r = run("run-task.sh", ["create-user"], { ...taskEnv, AWS_BIN: stub.bin, COMMAND_JSON: '{"a":1}' });
    expect(r.status).toBe(1);
    expect(readFileSync(stub.log, "utf8")).not.toContain("ecs run-task");
  });

  it("runs the newest revision by default (a deploy runs the version being deployed)", () => {
    const stub = taskStub(0);
    expect(run("run-task.sh", ["migrate"], { ...taskEnv, AWS_BIN: stub.bin }).status).toBe(0);
    expect(readFileSync(stub.log, "utf8")).toContain(`--task-definition ${REV}/jobproof-dev-ops:9`);
  });

  it("with TASK_VERSION=release runs the revision whose image is the released version", () => {
    const stub = taskStub(0);
    const r = run("run-task.sh", ["create-user"], {
      ...taskEnv,
      AWS_BIN: stub.bin,
      TASK_VERSION: "release",
      RELEASE_PARAMETER: "/jobproof/dev/release",
    });
    expect(r.status).toBe(0);
    const calls = readFileSync(stub.log, "utf8");
    expect(calls).toContain("ssm get-parameter --name /jobproof/dev/release");
    expect(calls).toContain(`--task-definition ${REV}/jobproof-dev-ops:8`);
    expect(calls).not.toContain(`--task-definition ${REV}/jobproof-dev-ops:9 --launch-type`);
  });

  it("with TASK_VERSION=release refuses a release marker that is not a commit SHA", () => {
    const bad = makeStub("aws", 'case "$1 $2" in "ssm get-parameter") echo "None" ;; *) exit 9 ;; esac');
    const r = run("run-task.sh", ["create-user"], {
      ...taskEnv,
      AWS_BIN: bad.bin,
      TASK_VERSION: "release",
      RELEASE_PARAMETER: "/jobproof/dev/release",
    });
    expect(r.status).toBe(1);
    expect(readFileSync(bad.log, "utf8")).not.toContain("run-task");
  });
});

// ---- promote-image.sh -----------------------------------------------------------------------

const SRC_URL = "222222222222.dkr.ecr.eu-west-2.amazonaws.com/jobproof-backend";
const DST_URL = "333333333333.dkr.ecr.eu-west-2.amazonaws.com/jobproof-backend";
const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;

/** dstDigests: what prod's describe-images answers, in order (the last answer repeats). */
function promote(srcDigest: string, dstDigests: string[]) {
  const dockerBin = makeStub("docker", "exit 0");
  const aws = makeStub(
    "aws",
    `case "$1 $2" in
  "ecr describe-images")
    case "$*" in
      *--registry-id*) echo "${srcDigest}" ;;
      *)
        n=$(cat "$DIR/n" 2>/dev/null || echo 0)
        n=$((n + 1)); echo $n > "$DIR/n"
        set -- ${dstDigests.map((d) => `"${d}"`).join(" ")}
        [ "$n" -gt "$#" ] && n=$#
        eval "echo \\\${$n}" ;;
    esac ;;
  "ecr get-login-password") echo token ;;
  *) echo "unexpected: $*" >&2; exit 9 ;;
esac`,
  );
  const r = run("promote-image.sh", [], {
    PATH: `${dockerBin.dir}:${process.env.PATH ?? ""}`,
    AWS_BIN: aws.bin,
    SOURCE_REPOSITORY_URL: SRC_URL,
    TARGET_REPOSITORY_URL: DST_URL,
    TAG: SHA,
  });
  return { ...r, docker: readFileSync(dockerBin.log, "utf8") };
}

describe("promote-image.sh", () => {
  it("copies by digest and succeeds when prod ends up with the same digest", () => {
    const r = promote(DIGEST_A, ["None", DIGEST_A]);
    expect(r.status).toBe(0);
    expect(r.docker).toContain(`pull ${SRC_URL}@${DIGEST_A}`);
    expect(r.docker).toContain(`push ${DST_URL}:${SHA}`);
  });

  it("dies when the copy in prod has a different digest", () => {
    const r = promote(DIGEST_A, ["None", DIGEST_B]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("the copy has digest");
  });

  it("dies when prod already has the tag with a different digest, and pushes nothing", () => {
    const r = promote(DIGEST_A, [DIGEST_B]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("different digest");
    expect(r.docker).not.toContain("push");
  });

  it("does nothing when prod already has the identical image, and dies when dev has no such tag", () => {
    const same = promote(DIGEST_A, [DIGEST_A]);
    expect(same.status).toBe(0);
    expect(same.docker).not.toContain("push");
    expect(promote("None", ["None"]).status).toBe(1);
  });

  it("refuses a tag that is not a 40 character commit SHA", () => {
    const aws = makeStub("aws", "exit 9");
    const r = run("promote-image.sh", [], {
      AWS_BIN: aws.bin,
      SOURCE_REPOSITORY_URL: SRC_URL,
      TARGET_REPOSITORY_URL: DST_URL,
      TAG: "latest",
    });
    expect(r.status).toBe(1);
    expect(readFileSync(aws.log, "utf8")).toBe("");
  });
});

// Used by the rollback path: find-task-definition.sh with the same stubbed ECS.
describe("find-task-definition.sh", () => {
  it("returns the revision of the requested family whose image has the version, and fails otherwise", () => {
    const stub = taskStub(0);
    const env = { AWS_BIN: stub.bin, API_FAMILY: "jobproof-dev-ops" };
    const ok = run("find-task-definition.sh", [], { ...env, VERSION: SHA });
    expect(ok.status).toBe(0);
    expect(ok.stdout.trim()).toBe(`${REV}/jobproof-dev-ops:8`);
    expect(run("find-task-definition.sh", [], { ...env, VERSION: OLD_SHA }).status).toBe(1);
    expect(run("find-task-definition.sh", [], { ...env, VERSION: "latest" }).status).toBe(1);
  });
});
