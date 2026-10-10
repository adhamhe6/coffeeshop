import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CircleCheckBig } from 'lucide-react';
import { useConfirmPasswordReset } from '@/lib/api/auth';
import { isApiError } from '@/lib/api/errors';
import { applyApiErrors } from '@/lib/forms';
import { useSeo } from '@/hooks/useSeo';
import { Button, Field, PasswordInput } from '@/design';
import { AuthShell, authLinkClass } from '../components/AuthShell';
import { FormAlert } from '../components/FormAlert';
import { PasswordStrength } from '../components/PasswordStrength';

const schema = z
  .object({
    new_password: z
      .string()
      .min(10, 'Use at least 10 characters.')
      .refine((v) => !/^\d+$/.test(v), 'Your password cannot be only numbers.'),
    confirm: z.string().min(1, 'Type the new password again.'),
  })
  .refine((v) => v.new_password === v.confirm, {
    path: ['confirm'],
    message: 'The passwords do not match.',
  });
type Values = z.infer<typeof schema>;

export default function ResetPasswordPage() {
  useSeo({ title: 'Choose a new password', noindex: true });
  const [params] = useSearchParams();
  const uid = params.get('uid') ?? '';
  const token = params.get('token') ?? '';
  const confirmReset = useConfirmPasswordReset();
  const [formError, setFormError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { new_password: '', confirm: '' },
  });
  const password = useWatch({ control, name: 'new_password' });

  const onSubmit = handleSubmit(async ({ new_password }) => {
    setFormError(null);
    try {
      await confirmReset.mutateAsync({ uid, token, new_password });
    } catch (e) {
      if (isApiError(e) && e.code === 'invalid_token') setExpired(true);
      else setFormError(applyApiErrors(e, setError, ['new_password']));
    }
  });

  const requestNew = (
    <Button asChild size="lg" block>
      <Link to="/forgot-password">Request a new link</Link>
    </Button>
  );

  let body;
  if (confirmReset.isSuccess) {
    body = (
      <div className="grid gap-5">
        <div
          role="status"
          className="flex items-start gap-3 rounded-lg border border-border bg-surface-raised p-5"
        >
          <CircleCheckBig aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
          <div>
            <p className="font-medium">Password updated</p>
            <p className="mt-1 text-[0.9375rem] text-text-muted">
              You can now sign in with your new password.
            </p>
          </div>
        </div>
        <Button asChild size="lg" block>
          <Link to="/login">Sign in</Link>
        </Button>
      </div>
    );
  } else if (!uid || !token || expired) {
    body = (
      <div className="grid gap-5">
        <FormAlert>
          {expired
            ? 'This reset link is invalid or has expired.'
            : 'This reset link is incomplete. Open the link from your email again, or request a new one.'}
        </FormAlert>
        {requestNew}
      </div>
    );
  } else {
    body = (
      <form
        onSubmit={onSubmit}
        noValidate
        className="grid gap-5"
        aria-label="Choose a new password"
      >
        <FormAlert>{formError}</FormAlert>
        <Field label="New password" required error={errors.new_password?.message}>
          <PasswordInput
            autoComplete="new-password"
            aria-describedby="reset-password-rules"
            {...register('new_password')}
          />
        </Field>
        <PasswordStrength id="reset-password-rules" password={password} />
        <Field label="Confirm new password" required error={errors.confirm?.message}>
          <PasswordInput autoComplete="new-password" {...register('confirm')} />
        </Field>
        <Button
          type="submit"
          size="lg"
          block
          loading={confirmReset.isPending}
          loadingText="Saving…"
        >
          Update password
        </Button>
      </form>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      description="Pick something you have not used elsewhere."
      quote="A fresh start, like a clean portafilter."
      footer={
        <Link to="/login" className={authLinkClass}>
          Back to sign in
        </Link>
      }
    >
      {body}
    </AuthShell>
  );
}
