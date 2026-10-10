import { useId, useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Copy, Dices, Info } from 'lucide-react';
import { useAuth } from '@/app/auth';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  Field,
  Input,
  PasswordInput,
  Select,
  toast,
} from '@/design';
import { FormAlert } from '@/features/account/components/FormAlert';
import { PasswordStrength } from '@/features/account/components/PasswordStrength';
import { useBranchOptions, useRoleMatrix, useSaveStaff } from '@/lib/api/adminPeople';
import type { AdminStaffMember, RoleInfo, StaffCreatePayload } from '@/lib/api/peopleTypes';
import { applyApiErrors } from '@/lib/forms';
import { Callout } from '../../people-kit/Callout';
import { generateTemporaryPassword } from '../password';
import { RolePreview } from './RolePreview';

type Mode = 'create' | 'edit';

interface Values {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  job_title: string;
  role: string;
  branch_ids: number[];
  password: string;
}

const makeSchema = (mode: Mode, roles: RoleInfo[]) =>
  z
    .object({
      first_name: z.string().trim().min(1, 'Enter a first name.').max(150),
      last_name: z.string().trim().max(150),
      email: z
        .string()
        .trim()
        .min(1, 'Enter an email address.')
        .email('Enter a valid email address.'),
      phone: z.string().trim().max(30, 'Keep the phone number under 30 characters.'),
      job_title: z.string().trim().max(80, 'Keep the job title under 80 characters.'),
      role: z.string().min(1, 'Choose a role.'),
      branch_ids: z.array(z.number()),
      password: z.string(),
    })
    .superRefine((v, ctx) => {
      const role = roles.find((r) => r.role === v.role);
      if (role?.branch_required && v.branch_ids.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['branch_ids'],
          message: `${role.label} must be assigned to at least one branch.`,
        });
      }
      if (mode === 'create') {
        if (v.password.length < 10) {
          ctx.addIssue({
            code: 'custom',
            path: ['password'],
            message: 'Use at least 10 characters.',
          });
        } else if (/^\d+$/.test(v.password)) {
          ctx.addIssue({
            code: 'custom',
            path: ['password'],
            message: 'The password cannot be only numbers.',
          });
        }
      }
    });

const FIELDS = [
  'first_name',
  'last_name',
  'email',
  'phone',
  'job_title',
  'role',
  'branch_ids',
  'password',
] as const;

interface StaffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `undefined` creates a new member. */
  member?: AdminStaffMember;
}

export function StaffDialog({ open, onOpenChange, member }: StaffDialogProps) {
  const mode: Mode = member ? 'edit' : 'create';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-4xl"
        title={
          mode === 'create' ? 'Add a staff member' : `Edit ${member?.first_name ?? 'staff member'}`
        }
        description={
          mode === 'create'
            ? 'They sign in with the same login page as customers and see the admin area their role allows.'
            : 'Changes to roles and branches take effect the next time they load a page.'
        }
      >
        {/* Mounted only while open, so every opening starts from a clean form. */}
        <StaffForm member={member} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function StaffForm({ member, onDone }: { member?: AdminStaffMember; onDone: () => void }) {
  const mode: Mode = member ? 'edit' : 'create';
  const { user, staff } = useAuth();
  const roleQuery = useRoleMatrix();
  const branchQuery = useBranchOptions();
  const roles = useMemo(() => roleQuery.data?.roles ?? [], [roleQuery.data]);
  const save = useSaveStaff();
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const pwHintId = useId();

  const actorIsSuper = staff?.role === 'SUPER_ADMIN';
  const editingSuper = member?.role === 'SUPER_ADMIN';
  const editingSelf = member?.id === user?.id;
  const locked = editingSuper && !actorIsSuper;

  const schema = useMemo(() => makeSchema(mode, roles), [mode, roles]);
  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: blank(member),
  });

  const roleKey = useWatch({ control, name: 'role' });
  const branchIds = useWatch({ control, name: 'branch_ids' });
  const password = useWatch({ control, name: 'password' });
  const email = useWatch({ control, name: 'email' });
  const names = [
    useWatch({ control, name: 'first_name' }),
    useWatch({ control, name: 'last_name' }),
  ];
  const role = roles.find((r) => r.role === roleKey);
  const showBranches = Boolean(role) && !role?.is_global;

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    const base = {
      email: v.email.trim(),
      first_name: v.first_name.trim(),
      last_name: v.last_name.trim(),
      phone: v.phone.trim(),
      job_title: v.job_title.trim(),
      role: v.role as StaffCreatePayload['role'],
      ...(role?.is_global ? {} : { branch_ids: v.branch_ids }),
    };
    try {
      if (member) {
        await save.mutateAsync({ id: member.id, update: base });
        toast.success(`${v.first_name} ${v.last_name}`.trim() + ' was updated.');
      } else {
        await save.mutateAsync({ create: { ...base, password: v.password } });
        toast.success(`${v.first_name} ${v.last_name}`.trim() + ' was added to the team.');
      }
      onDone();
    } catch (e) {
      setFormError(applyApiErrors(e, setError, FIELDS));
    }
  });

  const roleOptions = roles.map((r) => ({
    value: r.role,
    label: r.role === 'SUPER_ADMIN' && !actorIsSuper ? `${r.label} (super admins only)` : r.label,
    disabled: r.role === 'SUPER_ADMIN' && !actorIsSuper && member?.role !== 'SUPER_ADMIN',
  }));

  const copyPassword = async () => {
    try {
      await navigator.clipboard.writeText(password);
      toast.success('Password copied. Share it securely.');
    } catch {
      toast.error('Could not copy. Select the password and copy it manually.');
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6 md:grid-cols-[1fr_17rem]">
      <div className="grid content-start gap-4">
        {locked ? (
          <Callout tone="warning" title="Super admin account">
            Only a super admin can change this account.
          </Callout>
        ) : null}
        {editingSelf ? (
          <Callout title="This is your own account">
            Changing your own role could remove access to this page.
          </Callout>
        ) : null}
        {formError ? <FormAlert>{formError}</FormAlert> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" required error={errors.first_name?.message}>
            <Input {...register('first_name')} autoComplete="off" disabled={locked} />
          </Field>
          <Field label="Last name" error={errors.last_name?.message}>
            <Input {...register('last_name')} autoComplete="off" disabled={locked} />
          </Field>
        </div>
        <Field label="Email" required error={errors.email?.message}>
          <Input type="email" {...register('email')} autoComplete="off" disabled={locked} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone" error={errors.phone?.message}>
            <Input type="tel" {...register('phone')} autoComplete="off" disabled={locked} />
          </Field>
          <Field label="Job title" error={errors.job_title?.message}>
            <Input {...register('job_title')} autoComplete="off" disabled={locked} />
          </Field>
        </div>

        <Field label="Role" required error={errors.role?.message}>
          <Controller
            control={control}
            name="role"
            render={({ field }) => (
              <Select
                options={roleOptions}
                value={field.value || undefined}
                onValueChange={(v) => {
                  field.onChange(v);
                  const next = roles.find((r) => r.role === v);
                  if (next?.is_global) setValue('branch_ids', []);
                }}
                placeholder={roleQuery.isPending ? 'Loading roles…' : 'Choose a role'}
                disabled={locked || roleQuery.isPending}
              />
            )}
          />
        </Field>

        {showBranches ? (
          <fieldset className="grid gap-2" aria-describedby={`${pwHintId}-branches`}>
            <legend className="text-sm font-medium">
              Branches
              {role?.branch_required ? (
                <span aria-hidden="true" className="ml-0.5 text-danger">
                  *
                </span>
              ) : null}
            </legend>
            <p id={`${pwHintId}-branches`} className="text-sm text-text-muted">
              {role?.branch_required
                ? `${role.label} only sees the branches ticked here, and needs at least one.`
                : `${role?.label ?? 'This role'} can be limited to specific branches. Leave empty for no branch limit.`}
            </p>
            {branchQuery.isPending ? (
              <p className="text-sm text-text-muted">Loading branches…</p>
            ) : (
              <div className="grid gap-2 rounded-md border border-border-strong p-3 sm:grid-cols-2">
                {(branchQuery.data ?? []).map((b) => (
                  <Checkbox
                    key={b.id}
                    label={b.name}
                    checked={branchIds.includes(b.id)}
                    disabled={locked}
                    onCheckedChange={(checked) =>
                      setValue(
                        'branch_ids',
                        checked === true
                          ? [...branchIds, b.id]
                          : branchIds.filter((id) => id !== b.id),
                        { shouldValidate: true, shouldDirty: true },
                      )
                    }
                  />
                ))}
              </div>
            )}
            {errors.branch_ids?.message ? (
              <p role="alert" className="text-sm font-medium text-danger">
                {errors.branch_ids.message}
              </p>
            ) : null}
          </fieldset>
        ) : role?.is_global ? (
          <p className="flex items-start gap-2 text-sm text-text-muted">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {role.label} has access to every branch, so no branch needs to be chosen.
          </p>
        ) : null}

        {mode === 'create' ? (
          <div className="grid gap-2">
            <Field
              label="Temporary password"
              required
              error={errors.password?.message}
              hint="Share it through a secure channel. Ask them to change it after their first sign-in."
            >
              {showPassword ? (
                <Input
                  {...register('password')}
                  autoComplete="new-password"
                  spellCheck={false}
                  aria-describedby={pwHintId}
                />
              ) : (
                <PasswordInput
                  {...register('password')}
                  autoComplete="new-password"
                  aria-describedby={pwHintId}
                />
              )}
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={<Dices aria-hidden="true" className="size-4" />}
                onClick={() => {
                  setValue('password', generateTemporaryPassword(), {
                    shouldValidate: true,
                    shouldDirty: true,
                  });
                  setShowPassword(true);
                }}
              >
                Generate a strong password
              </Button>
              {showPassword && password ? (
                <Button
                  size="sm"
                  variant="ghost"
                  leadingIcon={<Copy aria-hidden="true" className="size-4" />}
                  onClick={() => void copyPassword()}
                >
                  Copy
                </Button>
              ) : null}
            </div>
            <PasswordStrength id={pwHintId} password={password} email={email} names={names} />
          </div>
        ) : null}

        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => onDone()} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending} disabled={locked}>
            {mode === 'create' ? 'Add staff member' : 'Save changes'}
          </Button>
        </div>
      </div>

      <aside className="md:sticky md:top-0 md:self-start">
        <RolePreview role={role} />
      </aside>
    </form>
  );
}

function blank(member?: AdminStaffMember): Values {
  return {
    first_name: member?.first_name ?? '',
    last_name: member?.last_name ?? '',
    email: member?.email ?? '',
    phone: member?.phone ?? '',
    job_title: member?.job_title ?? '',
    role: member?.role ?? '',
    branch_ids: member?.branch_ids ?? [],
    password: '',
  };
}
