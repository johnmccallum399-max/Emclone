import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { env } from "../config/env.js";

/**
 * Runs a locally installed, already-signed-in vendor CLI (Claude Code, Codex,
 * Gemini) for one hub turn, so an agent can use the user's own subscription
 * instead of a pay-per-token API key.
 *
 * Constraints that exist on purpose:
 * - Only the tools in CLI_PRESETS can run, never a user-supplied command.
 * - No shell is involved; arguments are passed as an array.
 * - The child gets a scrubbed environment. In particular it must NOT inherit
 *   API-key variables: the CLIs prefer an API key over the subscription login,
 *   which would silently switch the user to pay-per-token billing.
 * - The child runs in an empty temporary directory so its file tools have
 *   nothing of ours to read or modify.
 *
 * Flags below were taken from vendor docs and search summaries and have not
 * been run against signed-in CLIs; failures surface in the hub transcript with
 * the CLI's own error text.
 */

export type CliTool = "claude" | "codex" | "gemini";

interface CliPreset {
  bin: string;
  buildArgs(model: string | null): string[];
}

export const CLI_PRESETS: Record<CliTool, CliPreset> = {
  // Prompt is read from stdin in print mode.
  claude: {
    bin: "claude",
    buildArgs: (model) => ["-p", ...(model ? ["--model", model] : [])],
  },
  // "-" tells `codex exec` to read the prompt from stdin.
  codex: {
    bin: "codex",
    buildArgs: (model) => [
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      ...(model ? ["-m", model] : []),
      "-",
    ],
  },
  // Stdin is prepended to the -p text by the Gemini CLI.
  gemini: {
    bin: "gemini",
    buildArgs: (model) => [
      "-p",
      "Follow the instructions provided on stdin.",
      ...(model ? ["-m", model] : []),
    ],
  },
};

const CLI_MODEL_PATTERN = /^(claude|codex|gemini)(?::([A-Za-z0-9._-]+))?$/;

export const CLI_MODEL_HELP =
  'For CLI agents the model must be "claude", "codex" or "gemini", optionally followed by ":<model name>" (for example "claude:opus").';

export function isValidCliModel(model: string): boolean {
  return CLI_MODEL_PATTERN.test(model);
}

export interface CliInvocation {
  bin: string;
  args: string[];
}

export function buildCliInvocation(model: string): CliInvocation {
  const match = CLI_MODEL_PATTERN.exec(model);
  if (!match) throw new Error(CLI_MODEL_HELP);
  const preset = CLI_PRESETS[match[1] as CliTool];
  return { bin: preset.bin, args: preset.buildArgs(match[2] ?? null) };
}

/** Variables the CLIs genuinely need to find their saved login and run. */
const ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TERM",
  "TMPDIR",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "SystemRoot",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
];

function scrubbedEnv(): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) clean[key] = process.env[key];
  }
  return clean;
}

/** Hard cap on captured output so a runaway CLI cannot exhaust memory. */
const MAX_OUTPUT_BYTES = 1_000_000;

export interface RunCliOptions {
  timeoutMs: number;
  /** Overrides the environment; tests only. */
  env?: NodeJS.ProcessEnv;
}

function snippet(text: string): string {
  return text.trim().slice(0, 400);
}

/** Spawns `bin args`, writes `input` to stdin, and resolves with stdout. */
export async function runCli(invocation: CliInvocation, input: string, options: RunCliOptions): Promise<string> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-cli-"));

  try {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(invocation.bin, invocation.args, {
        cwd: workDir,
        env: options.env ?? scrubbedEnv(),
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      });

      let stdout = "";
      let stderr = "";
      let outputBytes = 0;
      let settled = false;

      const finish = (error: Error | null, value?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value ?? "");
      };

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(new Error(`${invocation.bin} timed out after ${Math.round(options.timeoutMs / 1000)}s`));
      }, options.timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > MAX_OUTPUT_BYTES) {
          child.kill("SIGKILL");
          finish(new Error(`${invocation.bin} produced more than ${MAX_OUTPUT_BYTES} bytes of output`));
          return;
        }
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        if (stderr.length < 4000) stderr += chunk.toString("utf8");
      });

      child.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") {
          finish(new Error(`"${invocation.bin}" was not found on PATH. Install it and sign in on this machine.`));
        } else {
          finish(err);
        }
      });

      child.on("close", (code) => {
        if (code !== 0) {
          const detail = snippet(stderr) || snippet(stdout) || "no output";
          finish(new Error(`${invocation.bin} exited with code ${code}: ${detail}`));
          return;
        }
        const text = stdout.trim();
        if (!text) {
          finish(new Error(`${invocation.bin} returned no output${stderr.trim() ? `: ${snippet(stderr)}` : ""}`));
          return;
        }
        finish(null, text);
      });

      // A CLI that exits before reading its input closes the pipe; the exit
      // code above already reports that, so ignore the write error.
      child.stdin.on("error", () => undefined);
      child.stdin.end(input);
    });
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/** One hub turn through a local CLI agent. */
export async function completeWithCli(model: string, turn: { system: string; prompt: string }): Promise<string> {
  if (!env.HUB_ENABLE_CLI_AGENTS) {
    throw new Error("CLI agents are disabled. Set HUB_ENABLE_CLI_AGENTS=true in the backend environment (local use only).");
  }
  const invocation = buildCliInvocation(model);
  const input = `${turn.system}\n\n${turn.prompt}`;
  return runCli(invocation, input, { timeoutMs: env.HUB_CLI_TIMEOUT_MS });
}
