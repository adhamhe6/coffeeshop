import { useState } from 'react';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { MailCheck } from 'lucide-react';
import { useRequestPasswordReset } from '@/lib/api/auth';
import { applyApiErrors } from '@/lib/forms';
import { useSeo } from '@/hooks/useSeo';
import { Button, Field, Input } from '@/design';
import { AuthShell, authLinkClass } from '../components/AuthShell';
import { FormAlert } from '../components/FormAlert';

const schema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Enter your email address.')
    .email('Enter a valid email address.'),
});
type Values = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  useSeo({ title: 'Reset your password', noindex: true });
  const reset = useRequestPasswordReset();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '' } });

  const onSubmit = handleSubmit(async ({ email }) => {
    setFormError(null);
    try {
      await reset.mutateAsync(email);
    } catch (e) {
      setFormError(applyApiErrors(e, setError, ['email']));
    }
  });

  return (
    <AuthShell
      title="Forgot your password?"
      description="Enter the email you signed up with and we will send you a link to choose a new one."
      quote="Even the best baristas forget the odd thing."
      footer={
        <Link to="/login" className={authLinkClass}>
          Back to sign in
        </Link>
      }
    >
      {reset.isSuccess ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-lg border border-border bg-surface-raised p-5"
        >
          <MailCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
          <div>
            <p className="font-medium">Check your inbox</p>
            <p className="mt-1 text-[0.9375rem] text-text-muted">
              If an account exists for that email, a reset link is on its way. The link works for
              one hour.
            </p>
          </div>
        </div>
      ) : (
        <form
          onSubmit={onSubmit}
          noValidate
          className="grid gap-5"
          aria-label="Request a password reset"
        >
          <FormAlert>{formError}</FormAlert>
          <Field label="Email" required error={errors.email?.message}>
            <Input type="email" autoComplete="email" inputMode="email" {...register('email')} />
          </Field>
          <Button type="submit" size="lg" block loading={reset.isPending} loadingText="Sending…">
            Send reset link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
