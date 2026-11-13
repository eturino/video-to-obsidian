import assert from "node:assert/strict";
import { test as it } from "node:test";
import { SupadataError } from "@supadata/js";
import {
  type FetchOptions,
  type FetchResult,
  fetchVideo,
  type VideoApi,
} from "../src/supadata.ts";

const URL = "https://youtu.be/abc";
const TRANSCRIPT = {
  lang: "en",
  availableLangs: ["en"],
  content: [{ text: "Hi.", offset: 1500, duration: 900, lang: "en" }],
};
const METADATA = {
  platform: "youtube",
  title: "A video",
  // recorded from YouTube: no username, whatever the SDK type says
  author: { displayName: "Chef" },
  createdAt: "2026-01-02T10:00:00Z",
};

it("joins the transcript and the metadata into one video", async () => {
  const result = await fetchVideo(fakeApi({}), URL, options());
  assert.deepEqual(result, {
    kind: "ok",
    warning: null,
    video: {
      url: URL,
      platform: "youtube",
      title: "A video",
      author: "Chef",
      publishedAt: "2026-01-02T10:00:00Z",
      lang: "en",
      segments: [{ text: "Hi.", offsetMs: 1500 }],
    },
  });
});

it("polls a transcript job until it completes", async () => {
  const statuses = [
    { status: "active" },
    { status: "completed", result: TRANSCRIPT },
  ];
  const api = fakeApi({
    transcript: { jobId: "j1" },
    jobStatus: () => statuses.shift(),
  });
  const result = await fetchVideo(api, URL, options());
  assert.equal(result.kind, "ok");
});

it("a job that stays queued is polled until the deadline", async () => {
  const api = queuedJobApi();
  await fetchVideo(api, URL, clockedOptions());
  assert.equal(api.calls.filter((c) => c === "jobStatus").length, 3);
});

it("a job that stays queued past the deadline times out", async () => {
  const result = await fetchVideo(queuedJobApi(), URL, clockedOptions());
  assert.deepEqual(result, { kind: "timeout" });
});

it("a video with no transcript reads as no transcript", async () => {
  const api = fakeApi({ transcript: refusal("transcript-unavailable") });
  const result = await fetchVideo(api, URL, options());
  assert.deepEqual(result, { kind: "noTranscript" });
});

it("no transcript skips the metadata call", async () => {
  const api = fakeApi({ transcript: refusal("transcript-unavailable") });
  await fetchVideo(api, URL, options());
  assert.deepEqual(api.calls, ["transcript"]);
});

it("a spent quota reads as the limit reached", async () => {
  const api = fakeApi({ transcript: refusal("limit-exceeded") });
  const result = await fetchVideo(api, URL, options());
  assert.deepEqual(result, { kind: "limitReached" });
});

it("a URL with no metadata keeps the transcript", async () => {
  const api = fakeApi({ metadata: refusal("invalid-request") });
  const result = await fetchVideo(api, URL, options());
  assert.equal(okResult(result).video.title, null);
});

it("metadata in a shape it cannot read keeps the note and warns", async () => {
  const api = fakeApi({ metadata: { title: "no platform" } });
  const result = await fetchVideo(api, URL, options());
  assert.match(String(okResult(result).warning), /metadata/u);
});

it("a metadata refusal keeps the paid transcript", async () => {
  const api = fakeApi({ metadata: refusal("internal-error") });
  const result = await fetchVideo(api, URL, options());
  assert.equal(result.kind, "ok");
});

// Narrows to the ok result; a failure here means the run did not succeed at all.
function okResult(result: FetchResult) {
  // biome-ignore lint/suspicious/noMisplacedAssertion: a narrowing helper, called only inside it()
  assert.ok(result.kind === "ok", `expected ok, got ${result.kind}`);
  return result;
}

interface FakeApi extends VideoApi {
  calls: string[];
}

// A response, or a SupadataError to throw, per call.
type Reply = unknown;

function fakeApi(replies: {
  transcript?: Reply;
  jobStatus?: () => Reply;
  metadata?: Reply;
}): FakeApi {
  const calls: string[] = [];
  const answer = async (name: string, reply: Reply) => {
    calls.push(name);
    if (reply instanceof SupadataError) throw reply;
    return reply;
  };
  return {
    calls,
    transcript: () => answer("transcript", replies.transcript ?? TRANSCRIPT),
    jobStatus: () => answer("jobStatus", replies.jobStatus?.()),
    metadata: () => answer("metadata", replies.metadata ?? METADATA),
  };
}

function refusal(error: SupadataError["error"]): SupadataError {
  return new SupadataError({ error, message: error, details: "" });
}

function queuedJobApi(): FakeApi {
  return fakeApi({
    transcript: { jobId: "j1" },
    jobStatus: () => ({ status: "queued" }),
  });
}

// A clock that only moves when the code under test sleeps: 10 s polls, 30 s deadline.
function clockedOptions(): FetchOptions {
  let clock = 0;
  return options({
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    pollMs: 10_000,
    timeoutMs: 30_000,
  });
}

function options(overrides: Partial<FetchOptions> = {}): FetchOptions {
  return {
    mode: "native",
    lang: null,
    sleep: async () => undefined,
    now: () => 0,
    pollMs: 0,
    timeoutMs: 60_000,
    ...overrides,
  };
}
