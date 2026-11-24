import type { ReactNode } from 'react';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import type { Nodes, Root } from 'mdast';

/**
 * Renders stored markdown (blueprint sections) as React elements. Raw HTML in the markdown is
 * shown as text, never injected, so the strict CSP holds and nothing can run.
 * Supports what the blueprint uses: paragraphs, headings, lists, tables, bold, italics,
 * inline code, links and block quotes.
 */
function safeHref(url: string): string | undefined {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

function render(node: Nodes, key: number | string): ReactNode {
  const kids = () => ('children' in node ? (node.children as Nodes[]).map((c, i) => render(c, i)) : null);
  switch (node.type) {
    case 'root':
      return <>{kids()}</>;
    case 'paragraph':
      return <p key={key}>{kids()}</p>;
    case 'heading':
      return node.depth <= 3 ? <h3 key={key}>{kids()}</h3> : <h4 key={key} className="mt-3 font-semibold">{kids()}</h4>;
    case 'text':
      return node.value;
    case 'strong':
      return <strong key={key} className="font-semibold text-ink">{kids()}</strong>;
    case 'emphasis':
      return <em key={key}>{kids()}</em>;
    case 'delete':
      return <del key={key}>{kids()}</del>;
    case 'inlineCode':
      return <code key={key}>{node.value}</code>;
    case 'code':
      return (
        <pre key={key} className="my-2 overflow-x-auto rounded bg-surface-2 p-2 text-xs">
          <code>{node.value}</code>
        </pre>
      );
    case 'break':
      return <br key={key} />;
    case 'link': {
      const href = safeHref(node.url);
      return href ? (
        <a key={key} href={href} rel="noopener noreferrer" target="_blank">
          {kids()}
        </a>
      ) : (
        <span key={key}>{kids()}</span>
      );
    }
    case 'list':
      return node.ordered ? <ol key={key}>{kids()}</ol> : <ul key={key}>{kids()}</ul>;
    case 'listItem':
      return (
        <li key={key}>
          {(node.children as Nodes[]).map((c, i) => (c.type === 'paragraph' ? <span key={i}>{(c.children as Nodes[]).map((x, j) => render(x, j))}</span> : render(c, i)))}
        </li>
      );
    case 'blockquote':
      return (
        <blockquote key={key} className="my-2 border-l-2 border-line pl-3">
          {kids()}
        </blockquote>
      );
    case 'table': {
      const [head, ...body] = node.children;
      return (
        <div key={key} className="my-3 overflow-x-auto rounded border border-line">
          <table className="data-table">
            {head ? (
              <thead>
                <tr>
                  {head.children.map((cell, i) => (
                    <th key={i}>{(cell.children as Nodes[]).map((c, j) => render(c, j))}</th>
                  ))}
                </tr>
              </thead>
            ) : null}
            <tbody>
              {body.map((row, r) => (
                <tr key={r}>
                  {row.children.map((cell, i) => (
                    <td key={i} className="text-ink-2">
                      {(cell.children as Nodes[]).map((c, j) => render(c, j))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case 'thematicBreak':
      return <hr key={key} className="my-3 border-line" />;
    case 'html':
      return <span key={key}>{node.value}</span>;
    default:
      return 'children' in node ? <span key={key}>{kids()}</span> : null;
  }
}

export function Markdown({ source }: { source: string }) {
  if (!source.trim()) return null;
  const tree = fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }) as Root;
  return <div className="prose-desk text-sm">{render(tree, 'root')}</div>;
}
