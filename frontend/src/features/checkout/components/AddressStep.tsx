import { useState } from 'react';
import { MapPin, Pencil, Plus, TriangleAlert } from 'lucide-react';
import { Badge, Button, Dialog, DialogContent, RadioCard, RadioGroup, Skeleton } from '@/design';
import { AddressForm } from '@/features/account/components/AddressForm';
import { useDeliveryZones, type Address } from '@/lib/api';
import { useAuth } from '@/app/auth';

/**
 * Delivery address picker with inline add/edit. A badge warns when an address' area is not served by the chosen
 * location (from `delivery-zones/`); the server preview remains the authority on fees and minimums.
 */
export function AddressStep({
  addresses,
  loading,
  value,
  branchSlug,
  onChange,
}: {
  addresses: Address[] | undefined;
  loading: boolean;
  value: number | null;
  branchSlug: string | null;
  onChange: (id: number) => void;
}) {
  const { user } = useAuth();
  const zones = useDeliveryZones();
  const [editing, setEditing] = useState<Address | 'new' | null>(null);

  const serves = (address: Address): boolean | null => {
    if (!address.zone || !zones.data || !branchSlug) return null;
    const zone = zones.data.find((z) => z.id === address.zone);
    return zone ? zone.branch_slugs.includes(branchSlug) : null;
  };

  return (
    <div className="grid gap-4">
      {loading ? (
        <div className="grid gap-3" aria-busy="true">
          <Skeleton className="h-24" />
        </div>
      ) : addresses && addresses.length > 0 ? (
        <RadioGroup
          value={value ? String(value) : ''}
          onValueChange={(v) => onChange(Number(v))}
          aria-label="Delivery address"
        >
          {addresses.map((address) => {
            const served = serves(address);
            return (
              <div key={address.id} className="grid gap-1.5">
                <RadioCard
                  value={String(address.id)}
                  icon={<MapPin aria-hidden="true" />}
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {address.label || address.recipient_name}
                      {address.is_default ? <Badge tone="neutral">Default</Badge> : null}
                    </span>
                  }
                  description={
                    <>
                      <span className="block">
                        {address.recipient_name} · {address.phone}
                      </span>
                      <span className="block">
                        {address.line1}
                        {address.line2 ? `, ${address.line2}` : ''}, {address.city}
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-2">
                        {address.zone_name ? (
                          <Badge tone="outline">{address.zone_name}</Badge>
                        ) : (
                          <Badge tone="warning">
                            <TriangleAlert aria-hidden="true" /> No delivery area set
                          </Badge>
                        )}
                        {served === false ? (
                          <Badge tone="danger">
                            <TriangleAlert aria-hidden="true" /> Not delivered from this location
                          </Badge>
                        ) : null}
                      </span>
                    </>
                  }
                />
                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(address)}
                    aria-label={`Edit address ${address.label || address.line1}`}
                  >
                    <Pencil aria-hidden="true" className="size-4" /> Edit
                  </Button>
                </div>
              </div>
            );
          })}
        </RadioGroup>
      ) : (
        <p className="text-sm text-text-muted">
          You have not saved an address yet. Add one to have your order delivered.
        </p>
      )}
      <div>
        <Button variant="secondary" onClick={() => setEditing('new')}>
          <Plus aria-hidden="true" className="size-4" /> Add a new address
        </Button>
      </div>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent
          title={editing && editing !== 'new' ? 'Edit address' : 'Add a delivery address'}
          description="Saved to your account so you can reuse it."
        >
          {editing ? (
            <AddressForm
              key={editing === 'new' ? 'new' : editing.id}
              address={editing === 'new' ? undefined : editing}
              defaults={{
                recipient_name: [user?.first_name, user?.last_name].filter(Boolean).join(' '),
                phone: user?.phone,
              }}
              suggestDefault={!addresses || addresses.length === 0}
              onSaved={(saved) => {
                setEditing(null);
                onChange(saved.id);
              }}
              onCancel={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
