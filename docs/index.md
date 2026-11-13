---
title: "Video links to Obsidian notes with the Supadata SDK"
---

# Video links to Obsidian notes with the Supadata SDK

[![Powered by Supadata](https://supadata.ai/badge/powered-by-supadata-light.svg)](https://supadata.ai/r/HQV5DNF7)

*Disclosure: the Supadata links on this page are my referral link, and Supadata gives me API credits
for this post and for the repo. The code is MIT and works the same without the link.*

I save a lot of videos I never watch again: recipes on Instagram, talks on YouTube, short tips on
TikTok. A link in a notes app is useless a month later, because search cannot see inside the video.
A transcript fixes that. This post walks through
[video-to-obsidian](https://github.com/eturino/video-to-obsidian), a small TypeScript CLI that
turns a video link into an Obsidian note with the full transcript, using
[Supadata](https://supadata.ai/r/HQV5DNF7) and its official JavaScript SDK.

```sh
pnpm start "https://www.youtube.com/watch?v=jNQXAC9IVRw" --out ~/Vault/Inbox
# /Users/me/Vault/Inbox/Me at the zoo.md
```

The note gets frontmatter (title, author, date, source), a heading, and the transcript in one
paragraph per minute, each starting with a timestamp.

## The shape of the code

Three files, each with one job:

- `src/supadata.ts` talks to Supadata and returns either a video or a reason it could not.
- `src/note.ts` turns a video into Markdown. It is pure, so it is easy to test.
- `src/cli.ts` reads the arguments and `.env`, checks the output folder, and writes the file.

Node 26 runs the `.ts` files directly, so there is no build step. Dependencies are the SDK and zod.

## Calling Supadata through a seam

The SDK gives you `new Supadata({ apiKey })` with `transcript()`, `transcript.getJobStatus()` and
`metadata()`. I did not call it from the logic directly. Instead, the logic depends on a three-method
interface I own, and one small function adapts the SDK to it:

```ts
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
```

The tests replace `VideoApi` with a hand-written fake, so they never touch the network or spend
credits. `text: false` asks for timed chunks instead of one block of text, which is what makes the
timestamps possible.

## Short videos answer at once, long ones return a job

For a short video, `transcript()` returns the transcript directly. For a long one, Supadata starts a
job and returns `{ jobId }`, which you poll. The code checks the response against both shapes with
zod and branches:

```ts
const body = await api.transcript(url, options.mode, options.lang);
const ready = transcriptSchema.safeParse(body);
if (ready.success) return segmentsOf(ready.data);
const job = jobStartSchema.safeParse(body);
if (job.success) return await pollJob(api, job.data.jobId, options);
return unexpected("transcript", body);
```

The polling loop has a deadline, so a stuck job cannot hang the CLI forever:

```ts
const deadline = options.now() + options.timeoutMs;
while (options.now() < deadline) {
  await options.sleep(options.pollMs);
  const job = jobSchema.safeParse(await api.jobStatus(jobId));
  // queued or active: keep polling. completed: return it. failed: say why.
}
return { kind: "timeout" };
```

`now` and `sleep` are passed in rather than taken from `Date.now` and `setTimeout`. The test gives
it a fake clock that moves only when the code sleeps, so it can check that a job which stays queued
is polled three times and then times out, in a millisecond.

## Why zod, when the SDK has types?

The SDK's TypeScript types describe what the API should send. zod checks what it actually sent. The
first live run showed the difference: the types say every author has a `username`, but YouTube
metadata comes back with only `displayName`. With a strict schema, the metadata was rejected. The
schema now asks only for the fields the note uses, and marks them optional.

Errors work the same way. The SDK throws a `SupadataError` with a code, and the CLI turns each code
into a message a person can act on: `transcript-unavailable` suggests `--mode auto`, and
`limit-exceeded` says you hit the rate limit or spent the month's credits.

## Paid calls go in the right order

Every call costs credits, so the order matters:

1. The CLI checks the output folder exists before calling anything. A typo in `--out` costs nothing.
2. It asks for the transcript first. Without one there is no note, so the metadata call is skipped.
3. If the metadata call fails after a good transcript, the note is still written, with the URL as
   its title and a warning. The transcript was already paid for.

A native transcript costs 1 credit and the metadata 1 more, so a typical note costs 2.

## Third-party text is not trusted

The title and the transcript come from whoever posted the video, and they end up in your vault.
Obsidian plugins can run code: a ` ```dataviewjs ` block runs JavaScript when Dataview is on. A
title with a line break followed by three backticks would open one. So the title is flattened to
one line, and Markdown, HTML and Obsidian characters in the title and transcript are escaped:

```ts
const MARKDOWN_CHARS = /[\\`*_[\]<>!$#|~=^%{}]/gu;

function escapeMarkdown(text: string): string {
  return text.replace(MARKDOWN_CHARS, "\\$&");
}
```

The frontmatter values go through `JSON.stringify`, because a JSON string is a valid YAML
double-quoted string. No YAML library needed.

## What a review caught

Before publishing, I had the repo reviewed. The tests passed and lint was clean, yet it found real
problems: `--help` printed a Node stack trace, a missing folder crashed after the credits were
spent, and the timeout test passed without ever polling (a timeout of 0 skipped the loop). Each fix
is its own commit in the history, if you want to see them one by one.

## Try it

```sh
git clone https://github.com/eturino/video-to-obsidian.git
cd video-to-obsidian
pnpm install
cp .env.template .env   # add your SUPADATA_API_KEY
pnpm start "<a video link>" --out <your vault folder>
```

You need Node 26 and a Supadata key. The [free plan](https://supadata.ai/r/HQV5DNF7) includes 100
credits a month, which is about 50 notes.
