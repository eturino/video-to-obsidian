// video-to-obsidian <url> [--out <folder>] [--lang <code>] [--mode native|auto|generate] [--help]
// Writes one Markdown note with the video's transcript and prints its path.
import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Supadata } from "@supadata/js";
import { noteFileName, renderNote } from "./note.ts";
import {
  type FetchResult,
  fetchVideo,
  sdkApi,
  transcriptModeSchema,
} from "./supadata.ts";

const USAGE =
  "Usage: pnpm start <video url> [--out <folder>] [--lang <code>] [--mode native|auto|generate] [--help]";
const POLL_MS = 5000;
const JOB_TIMEOUT_MS = 600_000;

const { values, positionals } = parseCliArgs();
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const url = positionals[0];
const apiKey = process.env.SUPADATA_API_KEY;
const mode = transcriptModeSchema.safeParse(values.mode);

if (url === undefined || positionals.length > 1) fail(USAGE);
if (!apiKey)
  fail("SUPADATA_API_KEY is missing. Copy .env.template to .env and set it.");
if (!mode.success) fail(`--mode must be native, auto or generate. ${USAGE}`);

// Checked before any paid call, so a typo in the folder costs no credits.
const folder = values.out ?? process.env.OBSIDIAN_FOLDER ?? ".";
if (!(await isFolder(folder))) {
  fail(
    `${folder} is not a folder. Create it, or fix --out or OBSIDIAN_FOLDER (~ is not expanded).`,
  );
}

const result = await fetchVideo(sdkApi(new Supadata({ apiKey })), url, {
  mode: mode.data,
  lang: values.lang ?? null,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: Date.now,
  pollMs: POLL_MS,
  timeoutMs: JOB_TIMEOUT_MS,
}).catch((error: unknown) => {
  // Node's fetch throws this TypeError when it cannot reach the host
  if (error instanceof TypeError && error.message === "fetch failed") {
    const reason = error.cause instanceof Error ? error.cause.message : "";
    fail(`Could not reach Supadata. Check your connection. ${reason}`.trim());
  }
  throw error;
});
if (result.kind !== "ok") fail(failureText(result));
if (result.warning !== null) {
  console.error(
    `Warning: no metadata, so the note uses the URL as its title (${result.warning}).`,
  );
}

const path = join(folder, noteFileName(result.video));
// The local date: a UTC one is a day off around midnight outside UTC.
const now = new Date();
const today = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, "0"),
  String(now.getDate()).padStart(2, "0"),
].join("-");
try {
  // "wx" never overwrites a note that is already in the vault
  await writeFile(path, renderNote(result.video, today), { flag: "wx" });
} catch (error) {
  if (error instanceof Error && "code" in error && error.code === "EEXIST") {
    fail(`${path} already exists. Move it or pass another --out folder.`);
  }
  throw error;
}
console.log(path);

function parseCliArgs() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        out: { type: "string" },
        lang: { type: "string" },
        mode: { type: "string", default: "native" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    // an unknown flag or a flag with no value: a usage error, not a crash
    if (error instanceof TypeError) fail(`${error.message}\n${USAGE}`);
    throw error;
  }
}

async function isFolder(candidate: string): Promise<boolean> {
  try {
    return (await stat(candidate)).isDirectory();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function failureText(failure: Exclude<FetchResult, { kind: "ok" }>): string {
  switch (failure.kind) {
    case "noTranscript":
      return "This video has no transcript. Try --mode auto to let Supadata generate one (costs more credits).";
    case "limitReached":
      return "Supadata limit reached: too many requests, or this month's credits are spent.";
    case "timeout":
      return "The transcript job did not finish in 10 minutes. Try again later.";
    case "failed":
      return `Supadata failed: ${failure.message}`;
  }
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
