import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/app/auth';
import { applyApiErrors } from '@/lib/forms';
import { safeNext } from '@/lib/nav';
import { useSeo } from '@/hooks/useSeo';
import { Button, Checkbox, Field, Input, PasswordInput, toast } from '@/design';
import { AuthShell, authLinkClass } from '../components/AuthShell';
import { FormAlert } from '../components/FormAlert';
import { PasswordStrength } from '../components/PasswordStrength';

const schema = z.object({
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
  password: z
    .string()
    .min(10, 'Use at least 10 characters.')
    .refine((v) => !/^\d+$/.test(v), 'Your password cannot be only numbers.'),
  marketing_opt_in: z.boolean(),
});
type Values = z.infer<typeof schema>;
const FIELDS = [
  'first_name',
  'last_name',
  'email',
  'phone',
  'password',
  'marketing_opt_in',
] as const;

export default function RegisterPage() {
  useSeo({ title: 'Create your account', noindex: true });
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  const { register: signUp, isAuthenticated } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      first_name: '',
      last_name: '',
      email: '',
      phone: '',
      password: '',
      marketing_opt_in: false,
    },
  });
  const [password, email, first, last, optIn] = useWatch({
    control,
    name: ['password', 'email', 'first_name', 'last_name', 'marketing_opt_in'],
  });

  if (isAuthenticated && !isSubmitting) return <Navigate to={next} replace />;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const user = await signUp({ ...values, phone: values.phone || undefined });
      toast.success(`Welcome to Lantern, ${user.first_name}.`);
      navigate(next, { replace: true });
    } catch (e) {
      setFormError(applyApiErrors(e, setError, FIELDS));
    }
  });

  return (
    <AuthShell
      title="Create your account"
      description="Order ahead, save your favorites and follow every order from the bar to your hands."
      quote="Your usual, ready when you are."
      footer={
        <>
          Already have an account?{' '}
          <Link
            to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`}
            className={authLinkClass}
          >
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-5" aria-label="Create account">
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
        <Field
          label="Phone"
          hint="Optional. Only used for order pick-up or delivery updates."
          error={errors.phone?.message}
        >
          <Input type="tel" autoComplete="tel" inputMode="tel" {...register('phone')} />
        </Field>
        <Field label="Password" required error={errors.password?.message}>
          <PasswordInput
            autoComplete="new-password"
            aria-describedby="register-password-rules"
            {...register('password')}
          />
        </Field>
        <PasswordStrength
          id="register-password-rules"
          password={password}
          email={email}
          names={[first, last]}
        />
        <Checkbox
          label="Send me news about new roasts and seasonal drinks"
          description="Optional. Unsubscribe any time."
          checked={optIn}
          onCheckedChange={(v) => setValue('marketing_opt_in', v === true)}
        />
        <Button
          type="submit"
          size="lg"
          block
          loading={isSubmitting}
          loadingText="Creating account…"
        >
          Create account
        </Button>
        <p className="text-sm text-text-muted">
          By creating an account you agree to our{' '}
          <Link to="/terms" className={authLinkClass}>
            Terms
          </Link>{' '}
          and{' '}
          <Link to="/privacy" className={authLinkClass}>
            Privacy Policy
          </Link>
          .
        </p>
      </form>
    </AuthShell>
  );
}
