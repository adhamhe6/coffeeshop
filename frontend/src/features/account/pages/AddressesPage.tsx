import { useState } from 'react';
import { MapPin, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { useAuth } from '@/app/auth';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  EmptyState,
  ErrorState,
  Skeleton,
  toast,
} from '@/design';
import { useSeo } from '@/hooks/useSeo';
import {
  useAddresses,
  useDeleteAddress,
  useSetDefaultAddress,
  type Address,
} from '@/lib/api/account';
import { describeError } from '@/lib/api/errors';
import { AccountShell } from '../components/AccountShell';
import { AddressForm } from '../components/AddressForm';

function AddressCard({
  address,
  onEdit,
  onDelete,
}: {
  address: Address;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const setDefault = useSetDefaultAddress();
  return (
    <li
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-5"
      data-testid="address-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 font-medium">
            <MapPin aria-hidden="true" className="size-4 text-text-muted" />
            {address.label || address.recipient_name}
            {address.is_default ? <Badge tone="accent">Default</Badge> : null}
          </h2>
          <address className="mt-2 text-[0.9375rem] text-text-muted not-italic">
            <span className="block">{address.recipient_name}</span>
            <span className="block">
              {address.line1}
              {address.line2 ? `, ${address.line2}` : ''}
            </span>
            <span className="block">
              {address.city}
              {address.postal_code ? ` ${address.postal_code}` : ''}
            </span>
            <span className="block">{address.phone}</span>
          </address>
          {address.instructions ? (
            <p className="mt-2 text-sm text-text-muted">Instructions: {address.instructions}</p>
          ) : null}
        </div>
        {address.zone_name ? (
          <Badge tone="outline">{address.zone_name}</Badge>
        ) : (
          <Badge tone="warning">No delivery area</Badge>
        )}
      </div>
      <div className="mt-auto flex flex-wrap gap-1 border-t border-border pt-3">
        <Button
          variant="ghost"
          size="sm"
          className="max-sm:h-11"
          onClick={onEdit}
          aria-label={`Edit ${address.label || address.line1}`}
          leadingIcon={<Pencil aria-hidden="true" className="size-4" />}
        >
          Edit
        </Button>
        {!address.is_default ? (
          <Button
            variant="ghost"
            size="sm"
            className="max-sm:h-11"
            loading={setDefault.isPending}
            onClick={() =>
              setDefault.mutate(address.id, {
                onSuccess: () => toast.success('Default address updated.'),
                onError: (e) => toast.error(describeError(e).message),
              })
            }
            aria-label={`Make ${address.label || address.line1} the default address`}
            leadingIcon={<Star aria-hidden="true" className="size-4" />}
          >
            Make default
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-danger max-sm:h-11"
          onClick={onDelete}
          aria-label={`Delete ${address.label || address.line1}`}
          leadingIcon={<Trash2 aria-hidden="true" className="size-4" />}
        >
          Delete
        </Button>
      </div>
    </li>
  );
}

export default function AddressesPage() {
  useSeo({ title: 'Your addresses', noindex: true });
  const { user } = useAuth();
  const addresses = useAddresses();
  const remove = useDeleteAddress();
  const [editing, setEditing] = useState<Address | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Address | null>(null);
  const list = addresses.data ?? [];

  const confirmDelete = () => {
    if (!deleting) return;
    remove.mutate(deleting.id, {
      onSuccess: () => {
        toast.success('Address deleted.');
        setDeleting(null);
      },
      onError: (e) => toast.error(describeError(e).message),
    });
  };

  return (
    <AccountShell
      title="Addresses"
      description="Where we deliver. The delivery area decides the fee and which locations can reach you."
      actions={
        <Button
          onClick={() => setEditing('new')}
          leadingIcon={<Plus aria-hidden="true" className="size-4" />}
        >
          Add address
        </Button>
      }
    >
      {addresses.isPending ? (
        <div className="grid gap-4 md:grid-cols-2" aria-busy="true">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
      ) : addresses.isError ? (
        <ErrorState
          error={addresses.error}
          onRetry={() => void addresses.refetch()}
          retrying={addresses.isFetching}
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<MapPin aria-hidden="true" />}
          title="No saved addresses"
          description="Add an address to get your order delivered, and reuse it at checkout."
          action={<Button onClick={() => setEditing('new')}>Add an address</Button>}
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2" aria-label="Saved addresses">
          {list.map((address) => (
            <AddressCard
              key={address.id}
              address={address}
              onEdit={() => setEditing(address)}
              onDelete={() => setDeleting(address)}
            />
          ))}
        </ul>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent
          title={editing && editing !== 'new' ? 'Edit address' : 'Add an address'}
          description="Saved to your account."
        >
          {editing ? (
            <AddressForm
              key={editing === 'new' ? 'new' : editing.id}
              address={editing === 'new' ? undefined : editing}
              defaults={{
                recipient_name: [user?.first_name, user?.last_name].filter(Boolean).join(' '),
                phone: user?.phone,
              }}
              suggestDefault={list.length === 0}
              onSaved={() => setEditing(null)}
              onCancel={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent
          title="Delete this address?"
          description={
            deleting
              ? `${deleting.label || deleting.line1} will be removed from your account. Past orders keep their own copy.`
              : undefined
          }
        >
          <DialogFooter className="-mx-6 -mb-5">
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={confirmDelete}
              loading={remove.isPending}
              loadingText="Deleting…"
            >
              Delete address
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AccountShell>
  );
}
