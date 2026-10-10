import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { Badge, Button, Tabs, TabsContent, TabsList, TabsTrigger, toast } from '@/design';
import { adminBranchesApi, type AdminBranch } from '@/lib/api/adminBranches';
import { aqk } from '@/lib/api/adminKeys';
import { useQueryClient } from '@tanstack/react-query';
import { ConfirmDialog } from '../../catalog-kit/ConfirmDialog';
import { BranchDetailsForm } from './BranchDetailsForm';
import { ClosuresPanel } from './ClosuresPanel';
import { DeliveryPanel } from './DeliveryPanel';
import { HoursEditor } from './HoursEditor';
import { OrderControls } from './OrderControls';
import { StaffPanel } from './StaffPanel';

interface BranchEditorProps {
  branch: AdminBranch | null;
  onCreated: (id: number) => void;
  onDeleted: () => void;
}

export function BranchEditor({ branch, onCreated, onDeleted }: BranchEditorProps) {
  const { hasCapability, staff } = useAuth();
  const canManage = hasCapability('branches.manage');
  // `branch_ids: null` means every branch (administrators); anything else is a scoped manager.
  const globalScope = staff?.branch_ids === null;
  const qc = useQueryClient();
  const [tab, setTab] = useState('details');
  const [deleting, setDeleting] = useState(false);

  if (!branch) {
    return (
      <div className="rounded-lg border border-border bg-surface-raised p-4 sm:p-5">
        <h2 className="mb-4 font-display text-h4 font-semibold">New branch</h2>
        <BranchDetailsForm
          branch={null}
          canManage={canManage}
          globalScope={globalScope}
          onCreated={onCreated}
        />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-display text-h3 font-medium">{branch.name}</h2>
        <Badge tone="outline" className="font-mono">
          {branch.code}
        </Badge>
        {!branch.is_active ? <Badge tone="neutral">Inactive</Badge> : null}
        {branch.is_placeholder_address ? <Badge tone="warning">Placeholder address</Badge> : null}
        {globalScope && canManage ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-danger"
            leadingIcon={<Trash2 aria-hidden="true" className="size-4" />}
            onClick={() => setDeleting(true)}
          >
            Delete…
          </Button>
        ) : null}
      </div>
      <OrderControls branch={branch} canManage={canManage} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Branch settings">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="hours">Opening hours</TabsTrigger>
          <TabsTrigger value="closures">Closures</TabsTrigger>
          <TabsTrigger value="delivery">Delivery</TabsTrigger>
          <TabsTrigger value="staff">Staff</TabsTrigger>
        </TabsList>
        <TabsContent value="details">
          <BranchDetailsForm
            key={branch.id}
            branch={branch}
            canManage={canManage}
            globalScope={globalScope}
            onCreated={() => undefined}
          />
        </TabsContent>
        <TabsContent value="hours">
          <HoursEditor branch={branch} canManage={canManage} />
        </TabsContent>
        <TabsContent value="closures">
          <ClosuresPanel branch={branch} canManage={canManage} />
        </TabsContent>
        <TabsContent value="delivery">
          <DeliveryPanel branch={branch} canManage={canManage} globalScope={globalScope} />
        </TabsContent>
        <TabsContent value="staff">
          <StaffPanel branch={branch} />
        </TabsContent>
      </Tabs>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${branch.name}?`}
        description="Branches with order history cannot be deleted; deactivate them instead. Deleting removes the branch, its hours, closures and stock records."
        confirmLabel="Delete branch"
        destructive
        onConfirm={async () => {
          await adminBranchesApi.remove(branch.id);
          await qc.invalidateQueries({ queryKey: aqk.branches.all });
          toast.success(`${branch.name} was deleted.`);
          onDeleted();
        }}
      />
    </div>
  );
}
