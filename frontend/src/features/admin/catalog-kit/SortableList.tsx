import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { IconButton } from '@/design';
import { cn } from '@/lib/cn';
import { moveItem } from './reorder';

interface SortableListProps<T> {
  items: readonly T[];
  getId: (item: T) => string | number;
  getLabel: (item: T) => string;
  /** Called with the full new order. */
  onReorder: (next: T[]) => void;
  renderItem: (item: T, index: number) => ReactNode;
  /** Accessible name of the list. */
  label: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Reorderable list. Keyboard and touch users get "Move up / Move down" buttons on every row (focus follows the moved
 * row, and the new position is announced); pointer users can also drag a row by its grip. No third-party DnD library.
 */
export function SortableList<T>({
  items,
  getId,
  getLabel,
  onReorder,
  renderItem,
  label,
  disabled,
  className,
}: SortableListProps<T>) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const focusRequest = useRef<{ id: string; dir: 'up' | 'down' } | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const req = focusRequest.current;
    if (!req || !listRef.current) return;
    focusRequest.current = null;
    const rows = listRef.current.querySelectorAll<HTMLElement>(
      `[data-row-id="${CSS.escape(req.id)}"]`,
    );
    const row = rows[0];
    if (!row) return;
    const preferred = row.querySelector<HTMLButtonElement>(`button[data-move="${req.dir}"]`);
    const fallback = row.querySelector<HTMLButtonElement>(
      `button[data-move="${req.dir === 'up' ? 'down' : 'up'}"]`,
    );
    (preferred && !preferred.disabled ? preferred : fallback)?.focus();
  }, [items]);

  const move = (from: number, to: number, dir: 'up' | 'down') => {
    if (to < 0 || to >= items.length || from === to) return;
    const item = items[from] as T;
    focusRequest.current = { id: String(getId(item)), dir };
    setAnnouncement(`${getLabel(item)} moved to position ${to + 1} of ${items.length}.`);
    onReorder(moveItem(items, from, to));
  };

  return (
    <div className={className}>
      <ol ref={listRef} aria-label={label} className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
        {items.map((item, index) => {
          const id = String(getId(item));
          const name = getLabel(item);
          return (
            <li
              key={id}
              data-row-id={id}
              draggable={!disabled}
              onDragStart={(e) => {
                setDragIndex(index);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', id);
              }}
              onDragOver={(e) => {
                if (dragIndex === null) return;
                e.preventDefault();
                setOverIndex(index);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null && dragIndex !== index) {
                  setAnnouncement(
                    `${getLabel(items[dragIndex] as T)} moved to position ${index + 1}.`,
                  );
                  onReorder(moveItem(items, dragIndex, index));
                }
                setDragIndex(null);
                setOverIndex(null);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
              className={cn(
                'flex items-center gap-2 rounded-md border border-border bg-surface-raised py-1.5 pr-1.5 pl-1',
                dragIndex === index && 'opacity-50',
                overIndex === index && dragIndex !== null && dragIndex !== index && 'border-accent',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center text-text-muted',
                  disabled ? 'opacity-40' : 'cursor-grab active:cursor-grabbing',
                )}
              >
                <GripVertical className="size-4" />
              </span>
              <div className="min-w-0 flex-1">{renderItem(item, index)}</div>
              <div className="flex shrink-0 items-center">
                <IconButton
                  label={`Move ${name} up`}
                  data-move="up"
                  size="icon-sm"
                  disabled={disabled || index === 0}
                  onClick={() => move(index, index - 1, 'up')}
                  icon={<ArrowUp aria-hidden="true" className="size-4" />}
                />
                <IconButton
                  label={`Move ${name} down`}
                  data-move="down"
                  size="icon-sm"
                  disabled={disabled || index === items.length - 1}
                  onClick={() => move(index, index + 1, 'down')}
                  icon={<ArrowDown aria-hidden="true" className="size-4" />}
                />
              </div>
            </li>
          );
        })}
      </ol>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
