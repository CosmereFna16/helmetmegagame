import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Renders Discord-message markdown (bold/italic/strikethrough/code/quotes/
// links/lists) as real elements rather than raw asterisks — used anywhere a
// DirectMessage's content is shown back to a GM. react-markdown never emits
// raw HTML from the source text by default (no rehype-raw plugin wired in),
// so this is safe against a player's message content injecting markup; images
// are dropped outright since a message shouldn't be able to embed one.
export default function MarkdownContent({ content, className }) {
  if (!content) return null;

  return (
    <div className={`markdown-content ${className ?? ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} disallowedElements={["img"]} unwrapDisallowed>
        {content}
      </ReactMarkdown>
    </div>
  );
}
