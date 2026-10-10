import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'react-router';
import { useAuth } from '@/app/auth';
import {
  Button,
  Field,
  Input,
  PasswordInput,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@/design';
import { FormAlert } from '@/features/account/components/FormAlert';
import { applyApiErrors } from '@/lib/forms';

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Enter your email address.')
    .email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});
type LoginValues = z.infer<typeof loginSchema>;

const registerSchema = z.object({
  first_name: z.string().trim().min(1, 'Enter your first name.').max(150),
  last_name: z.string().trim().min(1, 'Enter your last name.').max(150),
  email: z
    .string()
    .trim()
    .min(1, 'Enter your email address.')
    .email('Enter a valid email address.'),
  password: z
    .string()
    .min(10, 'Use at least 10 characters.')
    .refine((v) => !/^\d+$/.test(v), 'Your password cannot be only numbers.'),
});
type RegisterValues = z.infer<typeof registerSchema>;

function SignInForm() {
  const { login } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const user = await login(values);
      toast.success(`Welcome back${user.first_name ? `, ${user.first_name}` : ''}.`);
    } catch (e) {
      setFormError(applyApiErrors(e, setError, ['email', 'password']));
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4" aria-label="Sign in">
      <FormAlert>{formError}</FormAlert>
      <Field label="Email" required error={errors.email?.message}>
        <Input type="email" autoComplete="email" inputMode="email" {...register('email')} />
      </Field>
      <Field
        label="Password"
        required
        error={errors.password?.message}
        labelAction={
          <Link
            to="/forgot-password"
            className="font-medium text-accent-text underline underline-offset-4"
          >
            Forgot password?
          </Link>
        }
      >
        <PasswordInput autoComplete="current-password" {...register('password')} />
      </Field>
      <Button type="submit" size="lg" block loading={isSubmitting} loadingText="Signing in…">
        Sign in and continue
      </Button>
    </form>
  );
}

function CreateAccountForm() {
  const { register: signUp } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { first_name: '', last_name: '', email: '', password: '' },
  });
  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const user = await signUp(values);
      toast.success(`Welcome to Lantern, ${user.first_name}.`);
    } catch (e) {
      setFormError(applyApiErrors(e, setError, ['first_name', 'last_name', 'email', 'password']));
    }
  });
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4" aria-label="Create account">
      <FormAlert>{formError}</FormAlert>
      <div className="grid gap-4 sm:grid-cols-2">
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
        label="Password"
        required
        hint="At least 10 characters."
        error={errors.password?.message}
      >
        <PasswordInput autoComplete="new-password" {...register('password')} />
      </Field>
      <Button type="submit" size="lg" block loading={isSubmitting} loadingText="Creating account…">
        Create account and continue
      </Button>
      <p className="text-sm text-text-muted">
        By creating an account you agree to our{' '}
        <Link to="/terms" className="font-medium text-accent-text underline underline-offset-4">
          Terms
        </Link>{' '}
        and{' '}
        <Link to="/privacy" className="font-medium text-accent-text underline underline-offset-4">
          Privacy Policy
        </Link>
        .
      </p>
    </form>
  );
}

/** Checkout needs an account. Signing in or registering here keeps the cart (the server merges it). */
export function InlineAuth() {
  return (
    <section
      aria-labelledby="checkout-auth-title"
      className="rounded-lg border border-border bg-surface-raised p-5 sm:p-6"
    >
      <h2 id="checkout-auth-title" className="font-display text-h4 font-semibold">
        Sign in to place your order
      </h2>
      <p className="mt-1 text-sm text-text-muted">
        Your cart is saved and will be waiting for you. It only takes a moment.
      </p>
      <Tabs defaultValue="signin" className="mt-4">
        <TabsList aria-label="Sign in or create an account">
          <TabsTrigger value="signin">Sign in</TabsTrigger>
          <TabsTrigger value="register">Create account</TabsTrigger>
        </TabsList>
        <TabsContent value="signin">
          <SignInForm />
        </TabsContent>
        <TabsContent value="register">
          <CreateAccountForm />
        </TabsContent>
      </Tabs>
    </section>
  );
}
