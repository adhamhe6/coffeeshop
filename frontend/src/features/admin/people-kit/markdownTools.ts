export type MarkdownAction = 'bold' | 'italic' | 'heading' | 'link' | 'list' | 'quote';

export interface EditResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/**
 * Small, pure helpers behind the editor toolbar so non-technical editors never have to remember Markdown syntax.
 * `start`/`end` are the textarea selection; the result carries the new value and where the selection should be.
 */
export function applyMarkdown(
  value: string,
  start: number,
  end: number,
  action: MarkdownAction,
): EditResult {
  const selected = value.slice(start, end);
  const before = value.slice(0, start);
  const after = value.slice(end);

  const wrap = (mark: string, placeholder: string): EditResult => {
    const text = selected || placeholder;
    const next = `${before}${mark}${text}${mark}${after}`;
    const s = start + mark.length;
    return { value: next, selectionStart: s, selectionEnd: s + text.length };
  };

  const linePrefix = (prefix: string, placeholder: string): EditResult => {
    const lineStart = before.lastIndexOf('\n') + 1;
    const head = value.slice(0, lineStart);
    const body = value.slice(lineStart, end) || placeholder;
    const prefixed = body
      .split('\n')
      .map((l) => (l.startsWith(prefix) ? l : `${prefix}${l}`))
      .join('\n');
    const next = `${head}${prefixed}${after}`;
    return {
      value: next,
      selectionStart: head.length,
      selectionEnd: head.length + prefixed.length,
    };
  };

  switch (action) {
    case 'bold':
      return wrap('**', 'bold text');
    case 'italic':
      return wrap('*', 'italic text');
    case 'heading':
      return linePrefix('## ', 'Section heading');
    case 'list':
      return linePrefix('- ', 'List item');
    case 'quote':
      return linePrefix('> ', 'Quote');
    case 'link': {
      const text = selected || 'link text';
      const url = 'https://';
      const next = `${before}[${text}](${url})${after}`;
      const s = start + text.length + 3;
      return { value: next, selectionStart: s, selectionEnd: s + url.length };
    }
  }
}

/** Raw HTML is never rendered on the website; flag it so editors are not surprised. */
export function containsRawHtml(markdown: string): boolean {
  return /<\/?[a-z][\w-]*(\s[^>]*)?>/i.test(markdown.replace(/`[^`]*`/g, ''));
}
