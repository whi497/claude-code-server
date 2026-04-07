import React from 'react';
import { Copy } from 'lucide-react';

// ── Inline text formatting ──────────────────────────────────────
export function renderInline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code class="chat-inline-code">$1</code>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="chat-link" href="$2" target="_blank" rel="noopener">$1</a>');
}

// ── Table helpers ───────────────────────────────────────────────
export function isTableRow(line: string): boolean {
  return /^\|(.+\|)+\s*$/.test(line.trim());
}

export function isTableSeparator(line: string): boolean {
  return /^\|(\s*:?-+:?\s*\|)+\s*$/.test(line.trim());
}

function parseTableCells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}

export function renderTable(tableLines: string[]): React.ReactNode {
  if (tableLines.length < 2) return null;

  const headerLine = tableLines[0];
  const hasSeparator = tableLines.length > 1 && isTableSeparator(tableLines[1]);
  const headers = parseTableCells(headerLine);
  const bodyStart = hasSeparator ? 2 : 1;

  const alignments: ('left' | 'center' | 'right' | undefined)[] = [];
  if (hasSeparator) {
    const sepCells = parseTableCells(tableLines[1]);
    for (const cell of sepCells) {
      const trimmed = cell.trim();
      if (trimmed.startsWith(':') && trimmed.endsWith(':')) alignments.push('center');
      else if (trimmed.endsWith(':')) alignments.push('right');
      else alignments.push(undefined);
    }
  }

  const rows = tableLines.slice(bodyStart).map(line => parseTableCells(line));

  return (
    <div className="chat-table-wrapper">
      <table className="chat-table">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} style={alignments[i] ? { textAlign: alignments[i] } : undefined}
                  dangerouslySetInnerHTML={{ __html: renderInline(h) }} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} style={alignments[ci] ? { textAlign: alignments[ci] } : undefined}
                    dangerouslySetInnerHTML={{ __html: renderInline(cell) }} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Full markdown text renderer ─────────────────────────────────
export function renderMarkdown(text: string) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeLang = '';
  let tableLines: string[] = [];

  const flushCode = () => {
    if (codeLines.length > 0) {
      const code = codeLines.join('\n');
      elements.push(
        <div key={elements.length} className="chat-code-wrapper">
          {codeLang && <span className="chat-code-lang">{codeLang}</span>}
          <button className="chat-code-copy" onClick={() => navigator.clipboard.writeText(code)} title="Copy code">
            <Copy size={12} />
          </button>
          <pre className="chat-code-block">
            <code>{code}</code>
          </pre>
        </div>
      );
      codeLines = [];
    }
    inCodeBlock = false;
  };

  const flushTable = () => {
    if (tableLines.length > 0) {
      const table = renderTable(tableLines);
      if (table) elements.push(<span key={elements.length}>{table}</span>);
      tableLines = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      flushTable();
      if (inCodeBlock) {
        flushCode();
      } else {
        inCodeBlock = true;
        codeLang = line.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Table accumulation
    if (isTableRow(line) || (tableLines.length > 0 && isTableSeparator(line))) {
      tableLines.push(line);
      continue;
    } else if (tableLines.length > 0) {
      flushTable();
    }

    const processed = renderInline(line);

    // Headings
    if (line.startsWith('### ')) {
      elements.push(<h5 key={elements.length} className="chat-heading chat-h3" dangerouslySetInnerHTML={{ __html: renderInline(line.slice(4)) }} />);
    } else if (line.startsWith('## ')) {
      elements.push(<h4 key={elements.length} className="chat-heading chat-h2" dangerouslySetInnerHTML={{ __html: renderInline(line.slice(3)) }} />);
    } else if (line.startsWith('# ')) {
      elements.push(<h3 key={elements.length} className="chat-heading chat-h1" dangerouslySetInnerHTML={{ __html: renderInline(line.slice(2)) }} />);
    }
    // Numbered list items
    else if (/^\d+\.\s/.test(line)) {
      const match = line.match(/^(\d+)\.\s(.*)$/);
      if (match) {
        elements.push(
          <div key={elements.length} className="chat-list-item chat-ordered-item">
            <span className="chat-list-number">{match[1]}.</span>
            <span dangerouslySetInnerHTML={{ __html: renderInline(match[2]) }} />
          </div>
        );
      }
    }
    // Unordered list items
    else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(
        <div key={elements.length} className="chat-list-item" dangerouslySetInnerHTML={{ __html: '<span class="chat-bullet">•</span> ' + renderInline(line.slice(2)) }} />
      );
    }
    // Blockquote
    else if (line.startsWith('> ')) {
      elements.push(
        <blockquote key={elements.length} className="chat-blockquote" dangerouslySetInnerHTML={{ __html: renderInline(line.slice(2)) }} />
      );
    }
    // Horizontal rule
    else if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      elements.push(<hr key={elements.length} className="chat-hr" />);
    }
    // Empty line
    else if (line.trim() === '') {
      elements.push(<div key={elements.length} style={{ height: 8 }} />);
    }
    // Regular paragraph
    else {
      elements.push(<p key={elements.length} className="chat-paragraph" dangerouslySetInnerHTML={{ __html: processed }} />);
    }
  }

  flushTable();
  if (inCodeBlock) flushCode();
  return <>{elements}</>;
}
