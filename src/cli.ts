// video-to-obsidian <url> [--out <folder>] [--lang <code>] [--mode native|auto|generate]
// Writes one Markdown note with the video's transcript and prints its path.
import { writeFile } from "node:fs/promises";
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
  "Usage: pnpm start <video url> [--out <folder>] [--lang <code>] [--mode native|auto|generate]";
const POLL_MS = 5000;
const JOB_TIMEOUT_MS = 600_000;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" },
    lang: { type: "string" },
    mode: { type: "string", default: "native" },
  },
});

const url = positionals[0];
const apiKey = process.env.SUPADATA_API_KEY;
const mode = transcriptModeSchema.safeParse(values.mode);

if (url === undefined || positionals.length > 1) fail(USAGE);
if (!apiKey)
  fail("SUPADATA_API_KEY is missing. Copy .env.template to .env and set it.");
if (!mode.success) fail(`--mode must be native, auto or generate. ${USAGE}`);

const result = await fetchVideo(sdkApi(new Supadata({ apiKey })), url, {
  mode: mode.data,
  lang: values.lang ?? null,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  pollMs: POLL_MS,
  timeoutMs: JOB_TIMEOUT_MS,
});
if (result.kind !== "ok") fail(failureText(result));

const folder = values.out ?? process.env.OBSIDIAN_FOLDER ?? ".";
const path = join(folder, noteFileName(result.video));
const today = new Date().toISOString().slice(0, "YYYY-MM-DD".length);
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
