import { useId, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { controlBase, controlBorder, useFieldControl } from '@/design';

interface ChipInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  /** Normalise a typed value (trim, lowercase…). Return '' to ignore it. */
  normalise?: (raw: string) => string;
  /** Return a message to reject a value. */
  validate?: (value: string, current: string[]) => string | null;
  suggestions?: string[];
  max?: number;
  placeholder?: string;
  disabled?: boolean;
  /** Used in remove-button names, e.g. "allergen". */
  noun: string;
}

/** Type a value and press Enter or comma to add a chip; Backspace on an empty input removes the last chip. */
export function ChipInput({
  value,
  onChange,
  normalise = (s) => s.trim(),
  validate,
  suggestions,
  max,
  placeholder,
  disabled,
  noun,
}: ChipInputProps) {
  const field = useFieldControl();
  const listId = useId();
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const commit = (raw: string) => {
    const next = normalise(raw);
    if (!next) {
      setDraft('');
      return;
    }
    if (value.some((v) => v.toLowerCase() === next.toLowerCase())) {
      setProblem(`“${next}” is already added.`);
      return;
    }
    if (max !== undefined && value.length >= max) {
      setProblem(`At most ${max} ${noun}s.`);
      return;
    }
    const message = validate?.(next, value) ?? null;
    if (message) {
      setProblem(message);
      return;
    }
    setProblem(null);
    setDraft('');
    onChange([...value, next]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="grid gap-2">
      <div
        className={cn(
          controlBase,
          controlBorder,
          'flex min-h-11 flex-wrap items-center gap-1.5 px-2 py-1.5',
          'focus-within:border-text focus-within:outline-2 focus-within:outline-offset-1',
        )}
      >
        {value.map((chip) => (
          <span
            key={chip}
            className="inline-flex h-7 items-center gap-1 rounded-pill bg-neutral-bg pr-1 pl-2.5 text-sm text-neutral"
          >
            {chip}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(value.filter((v) => v !== chip))}
              aria-label={`Remove ${noun} ${chip}`}
              className="flex size-5 items-center justify-center rounded-full hover:bg-border"
            >
              <X aria-hidden="true" className="size-3" />
            </button>
          </span>
        ))}
        <input
          id={field?.id}
          list={suggestions?.length ? listId : undefined}
          value={draft}
          disabled={disabled}
          onChange={(e) => {
            setDraft(e.target.value);
            if (problem) setProblem(null);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => draft.trim() && commit(draft)}
          placeholder={value.length ? '' : placeholder}
          aria-invalid={Boolean(problem) || field?.invalid || undefined}
          aria-describedby={field?.describedBy}
          className="h-8 min-w-32 flex-1 bg-transparent px-1.5 text-base outline-none placeholder:text-text-muted/80"
        />
        {suggestions?.length ? (
          <datalist id={listId}>
            {suggestions
              .filter((s) => !value.includes(s))
              .map((s) => (
                <option key={s} value={s} />
              ))}
          </datalist>
        ) : null}
      </div>
      {problem ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
