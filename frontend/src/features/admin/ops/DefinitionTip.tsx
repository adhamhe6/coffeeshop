import { useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/design';
import { useReportDefinitions } from '@/lib/api/adminReports';

/**
 * (i) button that explains a metric with the backend's own definition wording (`admin/reports/definitions/`).
 * Opens on hover/focus and toggles on click/tap, so it also works on touch screens.
 */
export function DefinitionTip({ definitionKey, label }: { definitionKey: string; label: string }) {
  const { data } = useReportDefinitions();
  const [open, setOpen] = useState(false);
  // Hover opens it; a click then "pins" it open (so clicking never closes what hover just showed).
  const byHover = useRef(false);
  const def = data?.find((d) => d.key === definitionKey);
  if (!def) return null;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next && byHover.current) {
          byHover.current = false;
          return;
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`What does “${label}” mean?`}
          onPointerEnter={(e) => {
            if (e.pointerType !== 'mouse' || open) return;
            byHover.current = true;
            setOpen(true);
          }}
          onPointerLeave={(e) => {
            if (e.pointerType === 'mouse' && byHover.current) {
              byHover.current = false;
              setOpen(false);
            }
          }}
          className="relative inline-flex size-6 shrink-0 items-center justify-center rounded-full text-text-muted after:absolute after:-inset-2 hover:text-text"
        >
          <Info aria-hidden="true" className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        className="w-72 p-3 text-sm"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <p className="font-semibold">{def.label}</p>
        <p className="mt-1 text-text-muted">{def.definition}</p>
      </PopoverContent>
    </Popover>
  );
}
