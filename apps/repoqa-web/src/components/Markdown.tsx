import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Lightweight Markdown renderer for streamed assistant text. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="prose-sm prose prose-slate max-w-none text-sm leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}