import { useState, type ReactNode } from 'react';
import { Button, Dialog, DialogContent, Field, Textarea } from '@/design';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  /** Awaited; the parent closes the dialog on success. Show failures through `error`. */
  onConfirm: (reason: string) => void | Promise<void>;
  loading?: boolean;
  /** Message from the server when the last attempt failed. */
  error?: string | null;
  /** Ask for a free-text reason (sent to `onConfirm`). */
  reason?: { label: string; required?: boolean; maxLength?: number; hint?: ReactNode };
  children?: ReactNode;
}

/** Confirmation with a clearly named action, optional required reason, in-dialog server error. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  tone = 'primary',
  onConfirm,
  loading,
  error,
  reason,
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => (loading ? undefined : onOpenChange(o))}>
      <DialogContent title={title} description={description}>
        {/* Mounted only while open, so the typed reason never leaks into the next confirmation. */}
        <ConfirmBody
          onCancel={() => onOpenChange(false)}
          confirmLabel={confirmLabel}
          tone={tone}
          onConfirm={onConfirm}
          loading={loading}
          error={error}
          reason={reason}
        >
          {children}
        </ConfirmBody>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmBody({
  onCancel,
  confirmLabel,
  tone,
  onConfirm,
  loading,
  error,
  reason,
  children,
}: Pick<
  ConfirmDialogProps,
  'confirmLabel' | 'tone' | 'onConfirm' | 'loading' | 'error' | 'reason' | 'children'
> & { onCancel: () => void }) {
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const missing = Boolean(reason?.required) && text.trim().length === 0;

  const submit = async () => {
    if (missing) {
      setTouched(true);
      return;
    }
    await onConfirm(text.trim());
  };

  return (
    <div className="grid gap-4">
      {children}
      {reason ? (
        <Field
          label={reason.label}
          required={reason.required}
          hint={reason.hint}
          error={touched && missing ? 'Enter a reason to continue.' : undefined}
        >
          <Textarea
            rows={3}
            maxLength={reason.maxLength}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger/30 bg-danger-bg p-3 text-sm font-medium text-danger"
        >
          {error}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
        <Button
          variant={tone === 'danger' ? 'danger' : 'primary'}
          loading={loading}
          onClick={() => void submit()}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
