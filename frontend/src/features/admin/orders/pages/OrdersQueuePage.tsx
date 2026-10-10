import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useSeo } from '@/hooks/useSeo';
import { PageHeader } from '../../ops/PageHeader';
import { Segmented } from '../../ops/Segmented';
import { OrderBoard } from '../components/OrderBoard';
import { OrdersTable } from '../components/OrdersTable';

type View = 'board' | 'table';

export default function AdminOrdersQueuePage() {
  const [search, setSearch] = useSearchParams();
  const view: View = search.get('view') === 'table' ? 'table' : 'board';
  const [newCount, setNewCount] = useState(0);
  useSeo({
    title: `${newCount > 0 ? `(${newCount}) ` : ''}Orders · Admin`,
    noindex: true,
  });

  const setView = (v: View) =>
    setSearch(
      (prev) => {
        // Board and table keep separate filters: switching resets the URL to the target view.
        const next = new URLSearchParams();
        if (v === 'table') next.set('view', 'table');
        if (prev.get('branch')) next.set('branch', prev.get('branch') as string);
        return next;
      },
      { replace: false },
    );

  const setBoardParam = useCallback(
    (k: string, v: string | null) =>
      setSearch(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (v) next.set(k, v);
          else next.delete(k);
          return next;
        },
        { replace: true },
      ),
    [setSearch],
  );

  return (
    <div className="grid gap-4">
      <PageHeader
        title="Orders"
        description={
          view === 'board'
            ? 'The live queue, oldest first. Open an order to move it along.'
            : 'Search and filter every order. Filters are saved in the address.'
        }
        actions={
          <Segmented
            label="Orders view"
            value={view}
            onChange={setView}
            options={[
              { value: 'board', label: 'Queue board' },
              { value: 'table', label: 'Table' },
            ]}
          />
        }
      />
      {view === 'board' ? (
        <OrderBoard
          branch={search.get('branch') ?? ''}
          onBranch={(id) => setBoardParam('branch', id || null)}
          stuckOnly={search.get('stuck') === 'true'}
          onStuckOnly={(v) => setBoardParam('stuck', v ? 'true' : null)}
          onNewCount={setNewCount}
        />
      ) : (
        <OrdersTable />
      )}
    </div>
  );
}
