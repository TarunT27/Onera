import { Fragment, type ReactNode } from "react";

/**
 * Renders the small slice of Markdown model replies use: paragraphs, "- " and
 * "1. " lists, "#" headings, **bold** and `code`. Everything becomes React
 * text nodes, so nothing in a reply is ever parsed as HTML.
 */
export function RichText({ text }: { text: string }) {
  const blocks = text.replace(/\r\n/g, "\n").trim().split(/\n\s*\n/);
  const out: ReactNode[] = [];
  blocks.forEach((block, b) => {
    // Within a block, consecutive list lines become one list; other lines one paragraph.
    let run = null as Run | null;
    const flush = () => {
      if (!run) return;
      const key = `${b}-${out.length}`;
      if (run.kind === "p") {
        out.push(
          <p key={key}>
            {run.lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {HEADING.test(l) ? <strong>{inline(l.replace(HEADING, ""))}</strong> : inline(l)}
              </Fragment>
            ))}
          </p>,
        );
      } else {
        const List = run.kind;
        out.push(
          <List key={key}>
            {run.lines.map((l, j) => (
              <li key={j}>{inline(l)}</li>
            ))}
          </List>,
        );
      }
      run = null;
    };
    for (const line of block.split("\n")) {
      if (line.trim() === "") continue;
      const kind = BULLET.test(line) ? "ul" : NUMBERED.test(line) ? "ol" : "p";
      const content = kind === "ul" ? line.replace(BULLET, "") : kind === "ol" ? line.replace(NUMBERED, "") : line;
      if (run?.kind !== kind) {
        flush();
        run = { kind, lines: [] };
      }
      run?.lines.push(content);
    }
    flush();
  });
  return <>{out}</>;
}

type Run = { kind: "p" | "ul" | "ol"; lines: string[] };

const BULLET = /^\s*[-*•]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;
const HEADING = /^\s*#{1,4}\s+/;

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={i}>{part.slice(1, -1)}</code>;
    return part;
  });
}
