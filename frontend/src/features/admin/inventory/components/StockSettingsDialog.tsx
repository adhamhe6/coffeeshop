import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Dialog, DialogContent, DialogFooter, Field, Input, toast } from '@/design';
import { FormAlert } from '@/features/account/components/FormAlert';
import { aqk } from '@/lib/api/adminKeys';
import { adminInventoryApi, type StockItem } from '@/lib/api/adminInventory';
import { isApiError } from '@/lib/api/errors';
import { errorText } from '../../catalog-kit/errors';

const COST = /^\d{1,6}(\.\d{1,2})?$/;

export function validateThreshold(raw: string): string | null {
  if (!/^\d+$/.test(raw.trim())) return 'Use a whole number, 0 or more.';
  if (Number(raw) > 100000) return 'Use 100000 or less.';
  return null;
}
export function validateUnitCost(raw: string): string | null {
  if (raw.trim() === '') return null;
  return COST.test(raw.trim()) ? null : 'Use a number like 7.50, or leave blank.';
}

export function StockSettingsDialog({ item, onClose }: { item: StockItem; onClose: () => void }) {
  const qc = useQueryClient();
  const [threshold, setThreshold] = useState(String(item.low_stock_threshold));
  const [cost, setCost] = useState(item.unit_cost ?? '');
  const [errors, setErrors] = useState<{ threshold?: string; cost?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const next = {
      threshold: validateThreshold(threshold) ?? undefined,
      cost: validateUnitCost(cost) ?? undefined,
    };
    setErrors(next);
    if (next.threshold || next.cost) return;
    setBusy(true);
    setFormError(null);
    try {
      await adminInventoryApi.updateStock(item.id, {
        low_stock_threshold: Number(threshold),
        unit_cost: cost.trim() === '' ? null : cost.trim(),
      });
      await qc.invalidateQueries({ queryKey: aqk.inventory.all });
      toast.success(`Stock settings saved for ${item.product.name} at ${item.branch.name}.`);
      onClose();
    } catch (e) {
      if (isApiError(e) && e.fields.low_stock_threshold)
        setErrors({ threshold: e.fields.low_stock_threshold[0] });
      else if (isApiError(e) && e.fields.unit_cost) setErrors({ cost: e.fields.unit_cost[0] });
      else setFormError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent
        title={`Stock settings: ${item.product.name}`}
        description={`${item.branch.name}. The quantity itself is changed with a stock adjustment so the history stays complete.`}
      >
        <div className="grid gap-4">
          {formError ? <FormAlert>{formError}</FormAlert> : null}
          <Field
            label="Low-stock alert at"
            error={errors.threshold}
            hint="You are alerted when the quantity is at or below this number."
          >
            <Input
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              inputMode="numeric"
            />
          </Field>
          <Field
            label="Unit cost"
            error={errors.cost}
            hint="What one unit costs you. Used for stock valuation; optional."
          >
            <Input
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              inputMode="decimal"
              className="tabular-nums"
            />
          </Field>
        </div>
        <DialogFooter className="sticky -bottom-5 -mx-6 mt-5 -mb-5 bg-surface-raised">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={busy}>
            Save settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
