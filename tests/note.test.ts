import assert from "node:assert/strict";
import { test as it } from "node:test";
import {
  noteFileName,
  renderNote,
  timestamp,
  type Video,
} from "../src/note.ts";

const VIDEO = {
  url: "https://youtu.be/abc",
  platform: "youtube",
  title: 'How to "cook" rice: a guide',
  author: "Chef",
  publishedAt: "2026-01-02T10:00:00Z",
  lang: "en",
  segments: [
    { text: "Hello  and", offsetMs: 0 },
    { text: "welcome.", offsetMs: 2000 },
    { text: "  ", offsetMs: 30_000 },
    { text: "Now the rice.", offsetMs: 61_000 },
  ],
} satisfies Video;

it("renders frontmatter, heading and one paragraph per minute", () => {
  assert.equal(
    renderNote(VIDEO, "2026-11-13"),
    `---
title: "How to \\"cook\\" rice: a guide"
source: "https://youtu.be/abc"
platform: "youtube"
author: "Chef"
published: "2026-01-02T10:00:00Z"
lang: "en"
saved: "2026-11-13"
tags:
  - video
---

# How to "cook" rice: a guide

Source: https://youtu.be/abc

## Transcript

**[00:00]** Hello and welcome.

**[01:01]** Now the rice.
`,
  );
});

it("leaves out the fields the video does not have", () => {
  const note = renderNote(
    { ...VIDEO, platform: null, author: null, publishedAt: null },
    "2026-11-13",
  );
  assert.doesNotMatch(note, /^(?:platform|author|published):/mu);
});

// A third party's title and transcript: a code block and an embed, if not escaped
const HOSTILE = renderNote(
  {
    ...VIDEO,
    title: "Hi\n```dataviewjs",
    segments: [{ text: "![[secret]] <img src=x>", offsetMs: 0 }],
  },
  "2026-11-13",
);

it("a title with a line break stays on one escaped heading line", () => {
  assert.match(HOSTILE, /^# Hi \\`\\`\\`dataviewjs$/mu);
});

it("transcript syntax renders as plain text", () => {
  assert.match(
    HOSTILE,
    /^\*\*\[00:00\]\*\* \\!\\\[\\\[secret\\\]\\\] \\<img src\\=x\\>$/mu,
  );
});

it("file name drops the characters a path or an Obsidian link cannot hold", () => {
  assert.equal(noteFileName(VIDEO), "How to cook rice a guide.md");
});

it("file name falls back to the url without its slashes", () => {
  assert.equal(
    noteFileName({ ...VIDEO, title: null }),
    "https youtu.be abc.md",
  );
});

it("timestamps show hours only past the first hour", () => {
  assert.equal(timestamp(3_723_000), "1:02:03");
});
