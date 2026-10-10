import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/app/auth';
import { applyApiErrors } from '@/lib/forms';
import { safeNext } from '@/lib/nav';
import { useSeo } from '@/hooks/useSeo';
import { Button, Field, Input, PasswordInput, toast } from '@/design';
import { AuthShell, authLinkClass } from '../components/AuthShell';
import { FormAlert } from '../components/FormAlert';

const schema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Enter your email address.')
    .email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});
type Values = z.infer<typeof schema>;

export default function LoginPage() {
  useSeo({ title: 'Sign in', noindex: true });
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  const { login, isAuthenticated } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  // Already signed in (e.g. followed a stale /login link): skip the form.
  if (isAuthenticated && !isSubmitting) return <Navigate to={next} replace />;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const user = await login(values);
      toast.success(`Welcome back${user.first_name ? `, ${user.first_name}` : ''}.`);
      navigate(next, { replace: true });
    } catch (e) {
      setFormError(applyApiErrors(e, setError, ['email', 'password']));
    }
  });

  return (
    <AuthShell
      title="Welcome back"
      description="Sign in to order faster, track your orders and keep your favorites."
      footer={
        <>
          New to Lantern?{' '}
          <Link
            to={next === '/' ? '/register' : `/register?next=${encodeURIComponent(next)}`}
            className={authLinkClass}
          >
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-5" aria-label="Sign in">
        <FormAlert>{formError}</FormAlert>
        <Field label="Email" required error={errors.email?.message}>
          <Input type="email" autoComplete="email" inputMode="email" {...register('email')} />
        </Field>
        <Field
          label="Password"
          required
          error={errors.password?.message}
          labelAction={
            <Link to="/forgot-password" className={authLinkClass}>
              Forgot password?
            </Link>
          }
        >
          <PasswordInput autoComplete="current-password" {...register('password')} />
        </Field>
        <Button type="submit" size="lg" block loading={isSubmitting} loadingText="Signing in…">
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}
