import { useRef, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheckBig } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogFooter } from '@/design';
import { errorText } from '../../catalog-kit/errors';
import { runBulk, type BulkItem, type BulkResult } from '../bulk';

interface BulkActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** e.g. "Deactivate products" */
  title: string;
  /** Plain-language consequence shown before anything runs. */
  consequence: ReactNode;
  verb: string;
  items: BulkItem[];
  action: (item: BulkItem) => Promise<unknown>;
  /** Called after the run, with every result (so the page can refresh lists and clear selection). */
  onFinished: (results: BulkResult[]) => void;
}

type Phase = 'confirm' | 'running' | 'done';

/** confirm → sequential run with progress → report (successes, failures with reasons, retry failed). */
export function BulkActionDialog({
  open,
  onOpenChange,
  title,
  consequence,
  verb,
  items,
  action,
  onFinished,
}: BulkActionDialogProps) {
  const [phase, setPhase] = useState<Phase>('confirm');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<BulkResult[]>([]);
  const [stopped, setStopped] = useState(false);
  const stopRef = useRef(false);

  const start = async (list: BulkItem[], previous: BulkResult[] = []) => {
    stopRef.current = false;
    setPhase('running');
    setProgress({ done: 0, total: list.length });
    const outcome = await runBulk(list, action, {
      describeError: errorText,
      onProgress: (done, total) => setProgress({ done, total }),
      shouldStop: () => stopRef.current,
    });
    const merged = [
      ...previous.filter((p) => !list.some((l) => l.id === p.id)),
      ...outcome.results,
    ];
    setResults(merged);
    setStopped(outcome.stopped);
    setPhase('done');
    onFinished(merged);
  };

  const failed = results.filter((r) => !r.ok);
  const succeeded = results.filter((r) => r.ok);

  const close = (next: boolean) => {
    if (phase === 'running') return;
    if (!next) {
      setPhase('confirm');
      setResults([]);
      setStopped(false);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent title={title} hideClose={phase === 'running'}>
        {phase === 'confirm' ? (
          <div className="grid gap-3 text-sm">
            <p>{consequence}</p>
            <p className="font-medium">
              {items.length} product{items.length === 1 ? '' : 's'} selected:
            </p>
            <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-text-muted">
              {items.map((i) => (
                <li key={i.id}>{i.name}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {phase === 'running' ? (
          <div className="grid gap-3" aria-live="polite">
            <p className="text-sm font-medium">
              {verb} {progress.done} of {progress.total}…
            </p>
            <div
              role="progressbar"
              aria-label={`${verb} products`}
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
              className="h-2 overflow-hidden rounded-pill bg-surface-sunken"
            >
              <div
                className="h-full bg-accent transition-[width]"
                style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        ) : null}

        {phase === 'done' ? (
          <div className="grid gap-3 text-sm" role="status">
            <p className="flex items-center gap-2 font-medium">
              <CircleCheckBig aria-hidden="true" className="size-4 text-success" />
              {succeeded.length} updated
              {failed.length ? `, ${failed.length} failed` : ''}
              {stopped ? ' (stopped early)' : ''}
            </p>
            {failed.length ? (
              <div>
                <p className="mb-1.5 flex items-center gap-2 font-medium text-danger">
                  <CircleAlert aria-hidden="true" className="size-4" /> Not updated
                </p>
                <ul className="grid max-h-48 gap-1.5 overflow-y-auto">
                  {failed.map((f) => (
                    <li key={f.id} className="rounded-md bg-danger-bg px-3 py-2 text-danger">
                      <span className="font-medium">{f.name}</span>: {f.error}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter className="sticky -bottom-5 -mx-6 mt-5 -mb-5 bg-surface-raised">
          {phase === 'confirm' ? (
            <>
              <Button variant="secondary" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button onClick={() => void start(items)}>
                {verb} {items.length} product{items.length === 1 ? '' : 's'}
              </Button>
            </>
          ) : null}
          {phase === 'running' ? (
            <Button variant="secondary" onClick={() => (stopRef.current = true)}>
              Stop after current
            </Button>
          ) : null}
          {phase === 'done' ? (
            <>
              {failed.length ? (
                <Button
                  variant="secondary"
                  onClick={() =>
                    void start(
                      failed.map((f) => ({ id: f.id, name: f.name })),
                      results,
                    )
                  }
                >
                  Retry {failed.length} failed
                </Button>
              ) : null}
              <Button onClick={() => close(false)}>Done</Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
