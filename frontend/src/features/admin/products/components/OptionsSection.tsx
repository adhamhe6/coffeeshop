import { Link } from 'react-router';
import { ExternalLink, Trash2 } from 'lucide-react';
import { IconButton, Select } from '@/design';
import type { AdminModifierGroup } from '@/lib/api/adminCatalog';
import { SortableList } from '../../catalog-kit/SortableList';
import { GroupPreview } from './GroupPreview';
import { SectionCard } from './SectionCard';
import { useEditor } from './editorContext';
import { useListField } from './useListField';

export function OptionsSection() {
  const { groups, readOnly } = useEditor();
  const [ids, setIds] = useListField('modifier_group_ids');
  const attached = ids
    .map((id) => groups.find((g) => g.id === id))
    .filter((g): g is AdminModifierGroup => Boolean(g));
  const available = groups.filter((g) => !ids.includes(g.id));

  return (
    <SectionCard
      id="options"
      title="Options"
      description="Choices customers make before adding to the cart: size, milk, extras. Groups are shared across products."
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-full max-w-sm">
          <label htmlFor="attach-group" className="mb-1.5 block text-sm font-medium">
            Add an option group
          </label>
          <Select
            id="attach-group"
            value=""
            placeholder={available.length ? 'Choose a group to attach' : 'All groups are attached'}
            disabled={readOnly || available.length === 0}
            onValueChange={(v) => setIds([...ids, Number(v)])}
            options={available.map((g) => ({
              value: String(g.id),
              label: `${g.name}${g.is_active ? '' : ' (inactive)'}`,
            }))}
          />
        </div>
        <Link
          to="/admin/options"
          className="inline-flex items-center gap-1.5 text-sm text-accent-text underline underline-offset-4"
        >
          Manage option groups <ExternalLink aria-hidden="true" className="size-3.5" />
        </Link>
      </div>

      {attached.length === 0 ? (
        <p className="rounded-md border border-dashed border-border-strong p-4 text-sm text-text-muted">
          No option groups attached. Customers add this product to the cart as it is.
        </p>
      ) : (
        <>
          <div>
            <h3 className="mb-2 text-sm font-medium">Attached, in the order customers see them</h3>
            <SortableList
              label="Attached option groups"
              items={attached}
              getId={(g) => g.id}
              getLabel={(g) => g.name}
              disabled={readOnly}
              onReorder={(next) => setIds(next.map((g) => g.id))}
              renderItem={(g) => (
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{g.name}</p>
                    <p className="truncate text-xs text-text-muted">
                      Shown as “{g.display_name}” · {g.options.length} option
                      {g.options.length === 1 ? '' : 's'}
                      {g.is_active ? '' : ' · inactive'}
                    </p>
                  </div>
                  <IconButton
                    label={`Detach ${g.name}`}
                    size="icon-sm"
                    disabled={readOnly}
                    onClick={() => setIds(ids.filter((id) => id !== g.id))}
                    icon={<Trash2 aria-hidden="true" className="size-4" />}
                  />
                </div>
              )}
            />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium">What customers will see</h3>
            <div className="grid gap-2 md:grid-cols-2">
              {attached.map((g) => (
                <GroupPreview key={g.id} group={g} />
              ))}
            </div>
          </div>
        </>
      )}
    </SectionCard>
  );
}
