// Supadata through its official SDK: the transcript (polling the job that long
// videos return) and the post metadata, each response checked with zod before
// it is trusted. An API refusal comes back as a result with its reason; only a
// bug or a network failure throws.
import { type Supadata, SupadataError } from "@supadata/js";
import { z } from "zod";
import type { Segment, Video } from "./note.ts";

export const transcriptModeSchema = z.enum(["native", "auto", "generate"]);
export type TranscriptMode = z.infer<typeof transcriptModeSchema>;

export type FetchResult =
  | { kind: "ok"; video: Video }
  | { kind: "noTranscript" }
  | { kind: "limitReached" }
  | { kind: "timeout" }
  | { kind: "failed"; message: string };

// The part of Supadata this tool uses, so tests can replace it with a fake.
export interface VideoApi {
  transcript: (
    url: string,
    mode: TranscriptMode,
    lang: string | null,
  ) => Promise<unknown>;
  jobStatus: (jobId: string) => Promise<unknown>;
  metadata: (url: string) => Promise<unknown>;
}

export interface FetchOptions {
  mode: TranscriptMode;
  // null takes the video's own language
  lang: string | null;
  sleep: (ms: number) => Promise<void>;
  pollMs: number;
  timeoutMs: number;
}

export function sdkApi(client: Supadata): VideoApi {
  return {
    transcript: (url, mode, lang) =>
      client.transcript({
        url,
        mode,
        text: false,
        ...(lang === null ? {} : { lang }),
      }),
    jobStatus: (jobId) => client.transcript.getJobStatus(jobId),
    metadata: (url) => client.metadata({ url }),
  };
}

// The transcript goes first: without one there is no note, and the metadata call is not spent.
export async function fetchVideo(
  api: VideoApi,
  url: string,
  options: FetchOptions,
): Promise<FetchResult> {
  try {
    const transcript = await transcriptOf(api, url, options);
    if (transcript.kind !== "ok") return transcript;
    const found = await metadataOf(api, url);
    if (found.kind === "failed") return found;
    const meta = found.meta;
    return {
      kind: "ok",
      video: {
        url,
        platform: meta?.platform ?? null,
        title: meta?.title ?? null,
        author: meta?.author?.displayName || meta?.author?.username || null,
        publishedAt: meta?.createdAt ?? null,
        lang: transcript.lang,
        segments: transcript.segments,
      },
    };
  } catch (error) {
    if (error instanceof SupadataError) return fromSupadataError(error);
    throw error;
  }
}

const chunkSchema = z.object({ text: z.string(), offset: z.number() });
const transcriptSchema = z.object({
  lang: z.string(),
  content: z.union([z.string(), z.array(chunkSchema)]),
});
const jobStartSchema = z.object({ jobId: z.string() });
const jobSchema = z.object({
  status: z.enum(["queued", "active", "completed", "failed"]),
  result: transcriptSchema.nullish(),
  error: z.object({ message: z.string() }).nullish(),
});
// Only what the note shows. YouTube leaves out author.username, whatever the SDK's type says.
const metadataSchema = z.object({
  platform: z.string(),
  title: z.string().nullish(),
  author: z
    .object({
      username: z.string().nullish(),
      displayName: z.string().nullish(),
    })
    .nullish(),
  createdAt: z.string().nullish(),
});
// The documented codes; the SDK's own type misses upstream-error
const errorCodeSchema = z.enum([
  "invalid-request",
  "internal-error",
  "transcript-unavailable",
  "not-found",
  "unauthorized",
  "upgrade-required",
  "limit-exceeded",
  "upstream-error",
]);

type TranscriptResult =
  | { kind: "ok"; lang: string; segments: Segment[] }
  | Exclude<FetchResult, { kind: "ok" }>;

async function transcriptOf(
  api: VideoApi,
  url: string,
  options: FetchOptions,
): Promise<TranscriptResult> {
  const body = await api.transcript(url, options.mode, options.lang);
  const ready = transcriptSchema.safeParse(body);
  if (ready.success) return segmentsOf(ready.data);
  const job = jobStartSchema.safeParse(body);
  if (job.success) return await pollJob(api, job.data.jobId, options);
  return unexpected("transcript", body);
}

// Long videos come back as a job. The deadline stops a stuck job from hanging the CLI.
async function pollJob(
  api: VideoApi,
  jobId: string,
  options: FetchOptions,
): Promise<TranscriptResult> {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    // biome-ignore lint/performance/noAwaitInLoops: each poll waits for the previous one
    await options.sleep(options.pollMs);
    const body = await api.jobStatus(jobId);
    const job = jobSchema.safeParse(body);
    if (!job.success) return unexpected("transcript job", body);
    switch (job.data.status) {
      case "queued":
      case "active":
        continue;
      case "completed":
        return job.data.result
          ? segmentsOf(job.data.result)
          : unexpected("transcript job", body);
      case "failed":
        return {
          kind: "failed",
          message: job.data.error?.message ?? "the transcript job failed",
        };
    }
  }
  return { kind: "timeout" };
}

function segmentsOf(
  transcript: z.infer<typeof transcriptSchema>,
): TranscriptResult {
  const chunks =
    typeof transcript.content === "string"
      ? [{ text: transcript.content, offset: 0 }]
      : transcript.content;
  const segments = chunks
    .filter((c) => c.text.trim())
    .map((c) => ({ text: c.text, offsetMs: c.offset }));
  if (segments.length === 0) return { kind: "noTranscript" };
  return { kind: "ok", lang: transcript.lang, segments };
}

// The note still works without metadata (a plain video file has none), so an
// unsupported or unknown URL falls back to the URL as the title.
async function metadataOf(
  api: VideoApi,
  url: string,
): Promise<
  | { kind: "ok"; meta: z.infer<typeof metadataSchema> | null }
  | { kind: "failed"; message: string }
> {
  try {
    const body = await api.metadata(url);
    const parsed = metadataSchema.safeParse(body);
    return parsed.success
      ? { kind: "ok", meta: parsed.data }
      : unexpected("metadata", body);
  } catch (error) {
    if (
      error instanceof SupadataError &&
      (error.error === "invalid-request" || error.error === "not-found")
    ) {
      return { kind: "ok", meta: null };
    }
    throw error;
  }
}

function fromSupadataError(error: SupadataError): FetchResult {
  const code = errorCodeSchema.safeParse(error.error);
  if (!code.success) return { kind: "failed", message: error.message };
  switch (code.data) {
    case "transcript-unavailable":
      return { kind: "noTranscript" };
    case "limit-exceeded":
      return { kind: "limitReached" };
    case "unauthorized":
      return {
        kind: "failed",
        message: "Supadata refused the API key. Check SUPADATA_API_KEY.",
      };
    case "invalid-request":
    case "not-found":
    case "upgrade-required":
    case "internal-error":
    case "upstream-error":
      return { kind: "failed", message: `${code.data}: ${error.message}` };
  }
}

function unexpected(
  what: string,
  body: unknown,
): { kind: "failed"; message: string } {
  // JSON.stringify(undefined) is undefined at runtime, whatever its type says
  const shown = String(JSON.stringify(body)).slice(0, BODY_PREVIEW);
  return {
    kind: "failed",
    message: `Supadata sent a ${what} response this tool does not know: ${shown}`,
  };
}

const BODY_PREVIEW = 300;
