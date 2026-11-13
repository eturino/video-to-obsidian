# video-to-obsidian

[![Powered by Supadata](https://supadata.ai/badge/powered-by-supadata-light.svg)](https://supadata.ai/r/HQV5DNF7)

Turn a video link into an Obsidian note with its full transcript. One command, one Markdown file:
frontmatter with the title, author, date and source, then the transcript in paragraphs with
timestamps.

It works with any link [Supadata](https://supadata.ai/r/HQV5DNF7) can transcribe: YouTube, TikTok,
Instagram, X, Facebook and plain video files. It uses the official
[Supadata JavaScript SDK](https://github.com/supadata-ai/js).

I run the same flow inside my personal Telegram bot: I share a video from my phone, and the
transcript lands in my vault. This repo is that flow cut down to a CLI you can read in five minutes.

## Example

```sh
pnpm start "https://www.youtube.com/watch?v=jNQXAC9IVRw"
# notes/Me at the zoo.md
```

```markdown
---
title: "Me at the zoo"
source: "https://www.youtube.com/watch?v=jNQXAC9IVRw"
platform: "youtube"
author: "jawed"
published: "2005-04-24T00:00:00.000Z"
lang: "en"
saved: "2026-11-13"
tags:
  - video
---

# Me at the zoo

Source: https://www.youtube.com/watch?v=jNQXAC9IVRw

## Transcript

**[00:01]** All right, so here we are, in front of the elephants the cool thing about these guys is that they have really... really really long trunks and that's cool (baaaaaaaaaaahhh\!\!) and that's pretty much all there is to say
```

## Setup

You need Node 26 or later (it runs the TypeScript files directly, with no build step) and pnpm.

```sh
git clone https://github.com/eturino/video-to-obsidian.git
cd video-to-obsidian
pnpm install
cp .env.template .env
```

Then edit `.env`:

- `SUPADATA_API_KEY`: your key from the [Supadata dashboard](https://dash.supadata.ai). The free
  plan includes 100 credits a month.
- `OBSIDIAN_FOLDER` (optional): where notes go, for example your vault's inbox folder. Without it,
  notes go to the current folder.

`.env` is gitignored, so your key stays out of the repo.

## Usage

```sh
pnpm start <video url> [--out <folder>] [--lang <code>] [--mode native|auto|generate]
```

- `--out`: the folder for this note. It wins over `OBSIDIAN_FOLDER`.
- `--lang`: the transcript language, such as `en` or `es`. Without it, you get the video's own
  language.
- `--mode`: `native` (the default) uses existing captions only. `auto` falls back to an AI-generated
  transcript when there are none, and `generate` always generates one. Generated transcripts cost
  more credits, so `native` is the default.

The tool never overwrites a note: if the file already exists, it stops and says so.

## Credits

A note costs 2 credits with native captions: 1 for the transcript and 1 for the metadata (title,
author, date). If the video has no transcript, the metadata call is skipped. See
[Supadata pricing](https://supadata.ai/pricing) for generated transcripts.

## How it works

- `src/supadata.ts` calls the SDK. It asks for the transcript first. Long videos come back as a job,
  which it polls for up to 10 minutes. Then it fetches the metadata. Every response is checked with
  [zod](https://zod.dev) before it is used, and every Supadata refusal (no transcript, limit
  reached, bad key) becomes a clear message instead of a stack trace.
- `src/note.ts` renders the note. The title and transcript come from whoever posted the video, so
  Markdown, HTML and Obsidian syntax in them is escaped: a transcript cannot embed a file or start
  a code block that a plugin runs. It is pure, so the tests cover it without the network.
- `src/cli.ts` reads the arguments and `.env`, and writes the file.

## Development

```sh
pnpm test   # node:test, no network
pnpm lint   # Biome and tsc
```

## License

MIT
