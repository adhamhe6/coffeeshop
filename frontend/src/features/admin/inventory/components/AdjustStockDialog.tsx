import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  Field,
  Input,
  Radio,
  RadioGroup,
  Select,
  Textarea,
  toast,
} from '@/design';
import { FormAlert } from '@/features/account/components/FormAlert';
import { useBranchOptions } from '@/lib/api/adminBranches';
import { aqk } from '@/lib/api/adminKeys';
import { adminInventoryApi, useStockList, type ManualMovementType } from '@/lib/api/adminInventory';
import { isApiError } from '@/lib/api/errors';
import { errorText } from '../../catalog-kit/errors';
import {
  buildAdjustRequest,
  evaluateAdjustment,
  type AdjustDraft,
  type AdjustMode,
} from '../adjustRules';
import { ProductSearchField } from './ProductSearchField';

export interface AdjustTarget {
  branchId?: number;
  product?: { id: number; name: string; sku: string };
}

interface AdjustStockDialogProps {
  target: AdjustTarget;
  onClose: () => void;
}

const TYPES: Array<{ value: ManualMovementType; label: string; hint: string }> = [
  { value: 'RECEIPT', label: 'Stock receipt', hint: 'Units delivered. Adds to the quantity.' },
  { value: 'ADJUSTMENT', label: 'Adjustment', hint: 'Correct the count after a stock-take.' },
  { value: 'WASTE', label: 'Waste', hint: 'Spoiled, damaged or expired. Removes units.' },
];

export function AdjustStockDialog({ target, onClose }: AdjustStockDialogProps) {
  const qc = useQueryClient();
  const branches = useBranchOptions();
  const [branchId, setBranchId] = useState<number | undefined>(target.branchId);
  const [product, setProduct] = useState(target.product);
  const [draft, setDraft] = useState<AdjustDraft>({
    type: 'RECEIPT',
    mode: 'change',
    quantity: '',
    reason: '',
    reference: '',
  });
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const stock = useStockList(
    { branch: branchId, product: product?.id, page_size: 1 },
    branchId !== undefined && product !== undefined,
  );
  const current = stock.data?.results[0]?.quantity ?? 0;
  const loadingCurrent = stock.isPending && branchId !== undefined && product !== undefined;
  const outcome = evaluateAdjustment(draft, current);
  const ready = branchId !== undefined && product !== undefined && !loadingCurrent;
  const set = <K extends keyof AdjustDraft>(key: K, value: AdjustDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setServerError(null);
  };

  const submit = async () => {
    setTouched(true);
    const body = ready ? buildAdjustRequest(branchId, product.id, draft, outcome) : null;
    if (!body) return;
    setBusy(true);
    setServerError(null);
    try {
      const res = await adminInventoryApi.adjust(body);
      await qc.invalidateQueries({ queryKey: aqk.inventory.all });
      toast.success(
        `${product?.name} at ${res.stock_item.branch.name}: ${current} → ${res.stock_item.quantity}.`,
      );
      onClose();
    } catch (e) {
      setServerError(
        isApiError(e) && e.code === 'insufficient_stock'
          ? `${e.message} Refresh the stock level and try again.`
          : errorText(e),
      );
      void qc.invalidateQueries({ queryKey: aqk.inventory.stock() });
    } finally {
      setBusy(false);
    }
  };

  const showErrors = touched;
  const resultingText =
    outcome.resulting !== undefined ? (
      <span className="inline-flex items-center gap-2 font-medium tabular-nums">
        {current} <ArrowRight aria-hidden="true" className="size-4" /> {outcome.resulting}
        <span className="sr-only">
          from {current} to {outcome.resulting}
        </span>
      </span>
    ) : null;

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent
        title="Adjust stock"
        description="Every change is recorded in the movement history with your name."
      >
        <div className="grid gap-4">
          {serverError ? <FormAlert>{serverError}</FormAlert> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Branch" required>
              <Select
                value={branchId ? String(branchId) : undefined}
                onValueChange={(v) => setBranchId(Number(v))}
                disabled={target.branchId !== undefined}
                placeholder="Choose a branch"
                options={(branches.data ?? []).map((b) => ({ value: String(b.id), label: b.name }))}
              />
            </Field>
            {target.product ? (
              <Field label="Product">
                <Input value={`${target.product.name} (${target.product.sku})`} readOnly disabled />
              </Field>
            ) : (
              <ProductSearchField value={product} onChange={setProduct} />
            )}
          </div>

          <fieldset>
            <legend className="mb-2 text-sm font-medium">What happened?</legend>
            <RadioGroup
              value={draft.type}
              onValueChange={(v) => set('type', v as ManualMovementType)}
              aria-label="Movement type"
            >
              {TYPES.map((t) => (
                <Radio key={t.value} value={t.value} label={t.label} description={t.hint} />
              ))}
            </RadioGroup>
          </fieldset>

          {draft.type === 'ADJUSTMENT' ? (
            <fieldset>
              <legend className="mb-2 text-sm font-medium">How do you want to enter it?</legend>
              <RadioGroup
                value={draft.mode}
                onValueChange={(v) => set('mode', v as AdjustMode)}
                aria-label="Entry mode"
                className="sm:grid-cols-2"
              >
                <Radio value="change" label="Add or remove" description="Enter +5 or -3." />
                <Radio
                  value="set"
                  label="Set to counted quantity"
                  description="Enter what is on the shelf."
                />
              </RadioGroup>
            </fieldset>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={
                draft.type === 'RECEIPT'
                  ? 'Units received'
                  : draft.type === 'WASTE'
                    ? 'Units wasted'
                    : draft.mode === 'set'
                      ? 'Counted quantity'
                      : 'Change (+/−)'
              }
              required
              error={showErrors ? outcome.errors.quantity : undefined}
            >
              <Input
                value={draft.quantity}
                onChange={(e) => set('quantity', e.target.value)}
                inputMode="numeric"
                autoComplete="off"
                className="tabular-nums"
              />
            </Field>
            <Field
              label="Reference"
              error={showErrors ? outcome.errors.reference : undefined}
              hint="Optional: PO or delivery number."
            >
              <Input
                value={draft.reference}
                onChange={(e) => set('reference', e.target.value)}
                maxLength={60}
                autoComplete="off"
              />
            </Field>
          </div>
          <Field
            label="Reason"
            required={draft.type !== 'RECEIPT'}
            error={showErrors ? outcome.errors.reason : undefined}
            hint={
              draft.type === 'RECEIPT'
                ? 'Optional for receipts.'
                : 'Required: shown in the history.'
            }
          >
            <Textarea
              value={draft.reason}
              onChange={(e) => set('reason', e.target.value)}
              rows={2}
              maxLength={200}
            />
          </Field>

          <div
            role="status"
            aria-live="polite"
            className="flex items-center justify-between gap-3 rounded-md bg-surface-sunken px-3 py-2 text-sm"
          >
            <span className="text-text-muted">Resulting quantity</span>
            {!ready ? (
              <span className="text-text-muted">Choose a branch and product</span>
            ) : (
              (resultingText ?? <span className="text-text-muted tabular-nums">{current} now</span>)
            )}
          </div>
        </div>
        <DialogFooter className="sticky -bottom-5 -mx-6 mt-5 -mb-5 bg-surface-raised">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={!ready}>
            Record movement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
