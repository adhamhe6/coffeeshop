import { useRef, useState } from 'react';
import { Bold, Heading2, Italic, Link2, List, Quote } from 'lucide-react';
import { IconButton, Prose, Textarea } from '@/design';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { cn } from '@/lib/cn';
import { Callout } from '../../people-kit/Callout';
import {
  applyMarkdown,
  containsRawHtml,
  type MarkdownAction,
} from '../../people-kit/markdownTools';

const TOOLS: { action: MarkdownAction; label: string; icon: typeof Bold }[] = [
  { action: 'heading', label: 'Heading', icon: Heading2 },
  { action: 'bold', label: 'Bold', icon: Bold },
  { action: 'italic', label: 'Italic', icon: Italic },
  { action: 'link', label: 'Link', icon: Link2 },
  { action: 'list', label: 'Bulleted list', icon: List },
  { action: 'quote', label: 'Quote', icon: Quote },
];

interface MarkdownEditorProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  invalid?: boolean;
  describedBy?: string;
}

/**
 * Markdown textarea with a formatting toolbar and a live preview rendered by the storefront's own `<Prose/>`
 * (so what you see is what the website shows — and raw HTML is never rendered, here or there).
 */
export function MarkdownEditor({
  id,
  value,
  onChange,
  maxLength = 50_000,
  invalid,
  describedBy,
}: MarkdownEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [view, setView] = useState<'write' | 'preview'>('write');
  const preview = useDebouncedValue(value, 150);

  const run = (action: MarkdownAction) => {
    const el = ref.current;
    if (!el) return;
    const res = applyMarkdown(value, el.selectionStart, el.selectionEnd, action);
    onChange(res.value);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(res.selectionStart, res.selectionEnd);
    });
  };

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3 lg:hidden">
        <div
          role="group"
          aria-label="Editor view"
          className="inline-flex rounded-md border border-border-strong p-0.5"
        >
          {(['write', 'preview'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn(
                'h-9 rounded-sm px-4 text-sm font-medium capitalize',
                view === v ? 'bg-espresso text-cream' : 'text-text-muted hover:text-text',
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      {containsRawHtml(value) ? (
        <Callout tone="warning" title="HTML is not supported" role="status">
          Tags such as {'<div>'} or {'<script>'} are removed from the website for safety. Use the
          formatting buttons or Markdown instead.
        </Callout>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={cn('grid content-start gap-2', view === 'preview' && 'hidden lg:grid')}>
          <div role="toolbar" aria-label="Formatting" className="flex flex-wrap gap-1">
            {TOOLS.map(({ action, label, icon: Icon }) => (
              <IconButton
                key={action}
                label={label}
                size="icon-sm"
                variant="secondary"
                icon={<Icon aria-hidden="true" className="size-4" />}
                onClick={() => run(action)}
              />
            ))}
          </div>
          <Textarea
            ref={ref}
            id={id}
            rows={18}
            value={value}
            maxLength={maxLength}
            invalid={invalid}
            aria-describedby={describedBy}
            spellCheck
            onChange={(e) => onChange(e.target.value)}
            className="min-h-[24rem] font-mono text-sm leading-relaxed"
          />
          <p className="text-right text-xs text-text-muted tabular-nums">
            {value.length.toLocaleString()} / {maxLength.toLocaleString()} characters
          </p>
        </div>
        <section
          aria-label="Live preview"
          className={cn(
            'min-w-0 rounded-md border border-border bg-surface-raised p-5 lg:max-h-[36rem] lg:overflow-y-auto',
            view === 'write' && 'hidden lg:block',
          )}
        >
          <p className="mb-3 text-xs font-semibold tracking-wide text-text-muted uppercase">
            Preview — as shown on the website
          </p>
          {preview.trim() ? (
            <Prose>{preview}</Prose>
          ) : (
            <p className="text-sm text-text-muted">Start writing to see the preview.</p>
          )}
        </section>
      </div>
    </div>
  );
}
