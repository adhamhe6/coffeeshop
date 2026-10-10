import { useState, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogFooter } from '@/design';
import { errorText } from './errors';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Red button for destructive actions. */
  destructive?: boolean;
  /** Runs on confirm. Throw to keep the dialog open and show the message (the dialog closes on success). */
  onConfirm: () => Promise<unknown> | unknown;
  /** Extra content under the description (lists, notices). */
  children?: ReactNode;
}

/** Confirmation with async confirm, inline error display and focus kept inside. Escape / Cancel close it. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent title={title} description={description}>
        {children}
        {error ? (
          <p
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-md bg-danger-bg p-3 text-sm text-danger"
          >
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </p>
        ) : null}
        <DialogFooter className="sticky -bottom-5 -mx-6 mt-5 -mb-5 bg-surface-raised">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'danger' : 'primary'} onClick={run} loading={busy}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
