import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { LogOut, MailCheck, MailWarning } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { Button, Field, Input, PasswordInput, Switch, toast } from '@/design';
import { useChangePassword, useResendVerification, useUpdateProfile } from '@/lib/api/account';
import { describeError } from '@/lib/api/errors';
import { useSeo } from '@/hooks/useSeo';
import { applyApiErrors } from '@/lib/forms';
import { AccountShell } from '../components/AccountShell';
import { FormAlert } from '../components/FormAlert';
import { PasswordStrength } from '../components/PasswordStrength';

const profileSchema = z.object({
  first_name: z.string().trim().min(1, 'Enter your first name.').max(150),
  last_name: z.string().trim().min(1, 'Enter your last name.').max(150),
  email: z
    .string()
    .trim()
    .min(1, 'Enter your email address.')
    .email('Enter a valid email address.'),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^[+\d][\d\s().-]{5,}$/, 'Enter a valid phone number, or leave it blank.')
    .or(z.literal('')),
  marketing_opt_in: z.boolean(),
  current_password: z.string(),
});
type ProfileValues = z.infer<typeof profileSchema>;
const PROFILE_FIELDS = [
  'first_name',
  'last_name',
  'email',
  'phone',
  'marketing_opt_in',
  'current_password',
] as const;

function EmailStatus() {
  const { user } = useAuth();
  const resend = useResendVerification();
  if (!user || user.email_verified === undefined) return null;
  if (user.email_verified) {
    return (
      <p className="mb-5 flex items-center gap-2 text-sm text-success">
        <MailCheck aria-hidden="true" className="size-4" /> Email address confirmed
      </p>
    );
  }
  return (
    <div
      role="status"
      className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/30 bg-warning-bg p-3.5 text-sm text-warning"
    >
      <p className="flex items-start gap-2 font-medium">
        <MailWarning aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>Please confirm {user.email}. We sent you a link when you signed up.</span>
      </p>
      <Button
        size="sm"
        variant="secondary"
        loading={resend.isPending}
        onClick={() =>
          resend.mutate(undefined, {
            onSuccess: (r) => toast.success(r.detail),
            onError: (e) => toast.error(describeError(e).message),
          })
        }
      >
        Send the link again
      </Button>
    </div>
  );
}

function ProfileForm() {
  const { user } = useAuth();
  const update = useUpdateProfile();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    control,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      first_name: user?.first_name ?? '',
      last_name: user?.last_name ?? '',
      email: user?.email ?? '',
      phone: user?.phone ?? '',
      marketing_opt_in: user?.marketing_opt_in ?? false,
      current_password: '',
    },
  });
  const email = useWatch({ control, name: 'email' });
  const emailChanged = Boolean(user) && email.trim().toLowerCase() !== user?.email.toLowerCase();

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    if (emailChanged && !values.current_password) {
      setError('current_password', {
        type: 'required',
        message: 'Enter your current password to change your email address.',
      });
      return;
    }
    try {
      const saved = await update.mutateAsync({
        first_name: values.first_name,
        last_name: values.last_name,
        phone: values.phone,
        marketing_opt_in: values.marketing_opt_in,
        ...(emailChanged
          ? { email: values.email.trim(), current_password: values.current_password }
          : {}),
      });
      reset({
        first_name: saved.first_name,
        last_name: saved.last_name,
        email: saved.email,
        phone: saved.phone ?? '',
        marketing_opt_in: saved.marketing_opt_in ?? false,
        current_password: '',
      });
      toast.success('Your profile was saved.');
    } catch (e) {
      setFormError(applyApiErrors(e, setError, PROFILE_FIELDS));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5" aria-label="Profile details">
      <FormAlert>{formError}</FormAlert>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="First name" required error={errors.first_name?.message}>
          <Input autoComplete="given-name" {...register('first_name')} />
        </Field>
        <Field label="Last name" required error={errors.last_name?.message}>
          <Input autoComplete="family-name" {...register('last_name')} />
        </Field>
      </div>
      <Field label="Email" required error={errors.email?.message}>
        <Input type="email" autoComplete="email" inputMode="email" {...register('email')} />
      </Field>
      {emailChanged ? (
        <Field
          label="Current password"
          required
          hint="We ask for it to confirm a new email address."
          error={errors.current_password?.message}
        >
          <PasswordInput autoComplete="current-password" {...register('current_password')} />
        </Field>
      ) : null}
      <Field
        label="Phone"
        hint="Used for pickup and delivery updates."
        error={errors.phone?.message}
      >
        <Input type="tel" autoComplete="tel" inputMode="tel" {...register('phone')} />
      </Field>
      <Controller
        control={control}
        name="marketing_opt_in"
        render={({ field }) => (
          <Switch
            label="News about new roasts and seasonal drinks"
            description="Marketing email. Order updates are always sent."
            checked={field.value}
            onCheckedChange={field.onChange}
          />
        )}
      />
      <div>
        <Button type="submit" loading={isSubmitting} loadingText="Saving…" disabled={!isDirty}>
          Save changes
        </Button>
      </div>
    </form>
  );
}

const passwordSchema = z
  .object({
    current_password: z.string().min(1, 'Enter your current password.'),
    new_password: z
      .string()
      .min(10, 'Use at least 10 characters.')
      .refine((v) => !/^\d+$/.test(v), 'Your password cannot be only numbers.'),
    confirm: z.string(),
  })
  .refine((v) => v.new_password === v.confirm, {
    path: ['confirm'],
    message: 'The two passwords do not match.',
  });
type PasswordValues = z.infer<typeof passwordSchema>;

function PasswordForm() {
  const { user } = useAuth();
  const change = useChangePassword();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { current_password: '', new_password: '', confirm: '' },
  });
  const next = useWatch({ control, name: 'new_password' });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await change.mutateAsync({
        current_password: values.current_password,
        new_password: values.new_password,
      });
      reset();
      toast.success('Your password was changed.');
    } catch (e) {
      setFormError(applyApiErrors(e, setError, ['current_password', 'new_password']));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5" aria-label="Change password">
      <FormAlert>{formError}</FormAlert>
      <Field label="Current password" required error={errors.current_password?.message}>
        <PasswordInput autoComplete="current-password" {...register('current_password')} />
      </Field>
      <Field label="New password" required error={errors.new_password?.message}>
        <PasswordInput
          autoComplete="new-password"
          aria-describedby="profile-password-rules"
          {...register('new_password')}
        />
      </Field>
      <PasswordStrength
        id="profile-password-rules"
        password={next}
        email={user?.email}
        names={[user?.first_name ?? '', user?.last_name ?? '']}
      />
      <Field label="Confirm new password" required error={errors.confirm?.message}>
        <PasswordInput autoComplete="new-password" {...register('confirm')} />
      </Field>
      <div>
        <Button type="submit" loading={isSubmitting} loadingText="Changing…">
          Change password
        </Button>
      </div>
    </form>
  );
}

export default function ProfilePage() {
  useSeo({ title: 'Your profile', noindex: true });
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    // Leave the protected page first: once the session is gone the route guard would otherwise redirect to /login.
    try {
      await navigate('/', { replace: true });
      await logout();
      toast.success('You have been signed out.');
    } catch {
      toast.error('We could not sign you out. Please try again.');
      navigate('/account', { replace: true });
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <AccountShell
      title="Profile"
      description="Your details, password and preferences."
      actions={
        <Button
          variant="secondary"
          onClick={() => void signOut()}
          loading={signingOut}
          loadingText="Signing out…"
          leadingIcon={<LogOut aria-hidden="true" className="size-4" />}
        >
          Sign out
        </Button>
      }
    >
      <div className="grid gap-10 lg:grid-cols-2 lg:gap-14">
        <section aria-labelledby="profile-title">
          <h2 id="profile-title" className="mb-5 font-display text-h3 font-semibold">
            Your details
          </h2>
          <EmailStatus />
          <ProfileForm />
        </section>
        <section aria-labelledby="password-title">
          <h2 id="password-title" className="mb-5 font-display text-h3 font-semibold">
            Change password
          </h2>
          <PasswordForm />
        </section>
      </div>
    </AccountShell>
  );
}
