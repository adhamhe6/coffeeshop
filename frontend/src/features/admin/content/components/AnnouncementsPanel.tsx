import { useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  CalendarClock,
  CircleCheckBig,
  Megaphone,
  Pencil,
  Plus,
  Power,
  Trash2,
} from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Skeleton,
  Switch,
  toast,
} from '@/design';
import { FormAlert } from '@/features/account/components/FormAlert';
import {
  useAdminAnnouncements,
  useDeleteAnnouncement,
  useSaveAnnouncement,
} from '@/lib/api/adminMarketing';
import { describeError, isApiError } from '@/lib/api/errors';
import type { AdminAnnouncement } from '@/lib/api/peopleTypes';
import { applyApiErrors } from '@/lib/forms';
import { ConfirmDialog } from '../../people-kit/ConfirmDialog';
import { formatDateTime, isoToZonedInput, zonedInputToIso } from '../../people-kit/datetime';
import { safeLinkError } from '../../people-kit/validators';
import { useStoreTimeZone } from '../../people-kit/useStoreTimeZone';

const schema = z
  .object({
    message: z
      .string()
      .trim()
      .min(1, 'Write the announcement.')
      .max(200, 'Keep it under 200 characters.'),
    link_url: z.string().trim().max(300),
    starts_at: z.string(),
    ends_at: z.string(),
    is_active: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const err = safeLinkError(v.link_url);
    if (err) ctx.addIssue({ code: 'custom', path: ['link_url'], message: err });
    if (v.starts_at && v.ends_at && v.ends_at <= v.starts_at)
      ctx.addIssue({
        code: 'custom',
        path: ['ends_at'],
        message: 'The end must be after the start.',
      });
  });
type Values = z.infer<typeof schema>;

type LiveState = 'live' | 'scheduled' | 'ended' | 'off';
export function liveState(
  a: Pick<AdminAnnouncement, 'is_active' | 'starts_at' | 'ends_at'>,
  now = Date.now(),
): LiveState {
  if (!a.is_active) return 'off';
  if (a.ends_at && Date.parse(a.ends_at) <= now) return 'ended';
  if (a.starts_at && Date.parse(a.starts_at) > now) return 'scheduled';
  return 'live';
}

const STATE_UI = {
  live: { label: 'Live now', tone: 'success', icon: CircleCheckBig },
  scheduled: { label: 'Scheduled', tone: 'info', icon: CalendarClock },
  ended: { label: 'Ended', tone: 'neutral', icon: Power },
  off: { label: 'Switched off', tone: 'neutral', icon: Power },
} as const;

/** The strip visitors see above the header. */
function BarPreview({ message, link }: { message: string; link: string }) {
  return (
    <div
      data-surface="dark"
      className="rounded-md bg-espresso px-4 py-2.5 text-center text-sm text-text-inverse"
      aria-label="Announcement bar preview"
      role="img"
    >
      {message || 'Your announcement appears here'}
      {link ? <span className="ml-2 underline underline-offset-4">Learn more</span> : null}
    </div>
  );
}

export function AnnouncementsPanel() {
  const list = useAdminAnnouncements();
  const del = useDeleteAnnouncement();
  const [editing, setEditing] = useState<AdminAnnouncement | 'new' | null>(null);
  const [removing, setRemoving] = useState<AdminAnnouncement | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const { timeZone } = useStoreTimeZone();

  const items = list.data ?? [];
  const live = items.find((a) => liveState(a) === 'live');

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[65ch] text-sm text-text-muted">
          The announcement bar sits above the header on every storefront page. If several are live
          at once, visitors see the newest one.
        </p>
        <Button
          size="sm"
          leadingIcon={<Plus aria-hidden="true" className="size-4" />}
          onClick={() => setEditing('new')}
        >
          New announcement
        </Button>
      </div>

      {list.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Megaphone aria-hidden="true" />}
          title="No announcements"
          description="Add a message such as a seasonal drink or a holiday closing."
        />
      ) : (
        <>
          {live ? (
            <div>
              <p className="mb-2 text-xs font-semibold tracking-wide text-text-muted uppercase">
                Showing on the website now
              </p>
              <BarPreview message={live.message} link={live.link_url} />
            </div>
          ) : (
            <p className="rounded-md border border-dashed border-border-strong p-3 text-sm text-text-muted">
              No announcement is live right now, so the bar is hidden.
            </p>
          )}
          <ul className="grid gap-3" aria-label="Announcements">
            {items.map((a) => {
              const ui = STATE_UI[liveState(a)];
              const Icon = ui.icon;
              return (
                <li key={a.id} className="rounded-lg border border-border bg-surface-raised p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{a.message}</p>
                      <p className="mt-1 text-sm text-text-muted">
                        {a.link_url ? `Links to ${a.link_url} · ` : 'No link · '}
                        {a.starts_at || a.ends_at
                          ? `${a.starts_at ? formatDateTime(a.starts_at, { timeZone }) : 'now'} → ${a.ends_at ? formatDateTime(a.ends_at, { timeZone }) : 'no end'}`
                          : 'No schedule'}
                      </p>
                    </div>
                    <Badge tone={ui.tone}>
                      <Icon aria-hidden="true" />
                      {ui.label}
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      leadingIcon={<Pencil aria-hidden="true" className="size-3.5" />}
                      onClick={() => setEditing(a)}
                      aria-label={`Edit announcement: ${a.message}`}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      leadingIcon={<Trash2 aria-hidden="true" className="size-3.5" />}
                      onClick={() => {
                        setRemoveError(null);
                        setRemoving(a);
                      }}
                      aria-label={`Delete announcement: ${a.message}`}
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <AnnouncementDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        announcement={editing && editing !== 'new' ? editing : undefined}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Delete this announcement?"
        description={removing?.message}
        confirmLabel="Delete announcement"
        tone="danger"
        loading={del.isPending}
        error={removeError}
        onConfirm={async () => {
          if (!removing) return;
          try {
            await del.mutateAsync(removing.id);
            toast.success('Announcement deleted.');
            setRemoving(null);
          } catch (e) {
            setRemoveError(isApiError(e) ? e.message : describeError(e).message);
          }
        }}
      />
    </div>
  );
}

function AnnouncementDialog({
  open,
  onOpenChange,
  announcement,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  announcement?: AdminAnnouncement;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={announcement ? 'Edit announcement' : 'New announcement'}>
        {/* Mounted only while open, so every opening starts from a clean form. */}
        <AnnouncementForm announcement={announcement} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function AnnouncementForm({
  announcement,
  onDone,
}: {
  announcement?: AdminAnnouncement;
  onDone: () => void;
}) {
  const save = useSaveAnnouncement();
  const { timeZone, label } = useStoreTimeZone();
  const [formError, setFormError] = useState<string | null>(null);
  const initial = useMemo<Values>(
    () => ({
      message: announcement?.message ?? '',
      link_url: announcement?.link_url ?? '',
      starts_at: isoToZonedInput(announcement?.starts_at, timeZone),
      ends_at: isoToZonedInput(announcement?.ends_at, timeZone),
      is_active: announcement?.is_active ?? true,
    }),
    [announcement, timeZone],
  );
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: initial });
  const v = useWatch({ control }) as Values;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await save.mutateAsync({
        id: announcement?.id,
        payload: {
          message: values.message,
          link_url: values.link_url,
          is_active: values.is_active,
          starts_at: zonedInputToIso(values.starts_at, timeZone),
          ends_at: zonedInputToIso(values.ends_at, timeZone),
        },
      });
      toast.success(announcement ? 'Announcement saved.' : 'Announcement created.');
      onDone();
    } catch (e) {
      setFormError(
        applyApiErrors(e, setError, ['message', 'link_url', 'starts_at', 'ends_at', 'is_active']),
      );
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      {formError ? <FormAlert>{formError}</FormAlert> : null}
      <BarPreview message={v.message} link={v.link_url} />
      <Field
        label="Message"
        required
        error={errors.message?.message}
        hint={`${v.message.length}/200`}
      >
        <Input {...register('message')} maxLength={200} />
      </Field>
      <Field
        label="Link (optional)"
        error={errors.link_url?.message}
        hint="A page on this site like /menu, or a full https:// address."
      >
        <Input {...register('link_url')} maxLength={300} placeholder="/menu" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Show from"
          error={errors.starts_at?.message}
          hint={`Store time (${label}). Empty means immediately.`}
        >
          <Input type="datetime-local" {...register('starts_at')} />
        </Field>
        <Field label="Hide after" error={errors.ends_at?.message} hint="Empty means no end date.">
          <Input type="datetime-local" {...register('ends_at')} />
        </Field>
      </div>
      <Controller
        control={control}
        name="is_active"
        render={({ field }) => (
          <Switch label="Switched on" checked={field.value} onCheckedChange={field.onChange} />
        )}
      />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={() => onDone()} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {announcement ? 'Save announcement' : 'Create announcement'}
        </Button>
      </div>
    </form>
  );
}
