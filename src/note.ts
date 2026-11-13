// The Obsidian note for one video: frontmatter, a heading, and the transcript
// in paragraphs that each start with a timestamp. Pure, so it is easy to test.

export interface Segment {
  text: string;
  offsetMs: number;
}

export interface Video {
  url: string;
  platform: string | null;
  title: string | null;
  author: string | null;
  publishedAt: string | null;
  lang: string;
  segments: Segment[];
}

export function renderNote(video: Video, savedOn: string): string {
  const frontmatter = [
    "---",
    field("title", displayTitle(video)),
    field("source", video.url),
    ...optionalField("platform", video.platform),
    ...optionalField("author", video.author),
    ...optionalField("published", video.publishedAt),
    field("lang", video.lang),
    field("saved", savedOn),
    "tags:",
    "  - video",
    "---",
  ];
  const paragraphs = paragraphsOf(video.segments).map(
    (p) => `**[${timestamp(p.offsetMs)}]** ${escapeMarkdown(p.text)}`,
  );
  const body = [
    `# ${escapeMarkdown(displayTitle(video))}`,
    "",
    `Source: ${video.url}`,
    "",
    "## Transcript",
    "",
    paragraphs.join("\n\n"),
  ];
  return `${[...frontmatter, "", ...body].join("\n")}\n`;
}

// A file name every OS and Obsidian accept: no path separators or link characters.
export function noteFileName(video: Video): string {
  const cleaned = displayTitle(video)
    .replace(UNSAFE_FILE_CHARS, " ")
    .replace(WHITESPACE, " ")
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .trim();
  return `${cleaned || "Video"}.md`;
}

export function timestamp(offsetMs: number): string {
  const total = Math.floor(offsetMs / MS_PER_SECOND);
  const hours = Math.floor(total / SECONDS_PER_HOUR);
  const minutes = Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const seconds = total % SECONDS_PER_MINUTE;
  const mmss = `${pad(minutes)}:${pad(seconds)}`;
  return hours > 0 ? `${hours}:${mmss}` : mmss;
}

const MAX_NAME_LENGTH = 120;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
// One paragraph per minute of video keeps the timestamps useful without a line per caption.
const PARAGRAPH_MS = 60_000;
const UNSAFE_FILE_CHARS = /[\\/:*?"<>|#^[\]\p{Cc}]/gu;
const WHITESPACE = /\s+/gu;
// Markdown, HTML and Obsidian syntax (embeds, comments, math, tags, block refs)
const MARKDOWN_CHARS = /[\\`*_[\]<>!$#|~=^%{}]/gu;

// One line: a line break in a third party's title could open a code block that a plugin runs.
function displayTitle(video: Video): string {
  return (video.title ?? "").replace(WHITESPACE, " ").trim() || video.url;
}

// Title and transcript come from whoever posted the video, so they render as plain text.
function escapeMarkdown(text: string): string {
  return text.replace(MARKDOWN_CHARS, "\\$&");
}

// JSON strings are valid YAML double-quoted scalars, so no YAML library is needed.
function field(name: string, value: string): string {
  return `${name}: ${JSON.stringify(value)}`;
}

function optionalField(name: string, value: string | null): string[] {
  return value === null ? [] : [field(name, value)];
}

function paragraphsOf(segments: Segment[]): Segment[] {
  const paragraphs: Segment[] = [];
  for (const segment of segments) {
    const text = segment.text.replace(WHITESPACE, " ").trim();
    if (!text) continue;
    const last = paragraphs.at(-1);
    if (last && segment.offsetMs - last.offsetMs < PARAGRAPH_MS) {
      last.text = `${last.text} ${text}`;
    } else {
      paragraphs.push({ text, offsetMs: segment.offsetMs });
    }
  }
  return paragraphs;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
