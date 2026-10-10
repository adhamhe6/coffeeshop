import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2 } from 'lucide-react';
import { useNewsletterSubscribe } from '@/lib/api/newsletter';
import { isApiError } from '@/lib/api/errors';
import { Button, Field, Input } from '@/design';
import { cn } from '@/lib/cn';

const schema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Enter your email address.')
    .email('Enter a valid email address.'),
});
type Values = z.infer<typeof schema>;

interface NewsletterFormProps {
  /** `dark` renders for espresso backgrounds. */
  tone?: 'light' | 'dark';
  className?: string;
}

export function NewsletterForm({ tone = 'light', className }: NewsletterFormProps) {
  const subscribe = useNewsletterSubscribe();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '' } });

  const onSubmit = handleSubmit(async ({ email }) => {
    try {
      await subscribe.mutateAsync(email);
      reset();
    } catch (e) {
      if (isApiError(e) && e.fields.email?.[0]) setError('email', { message: e.fields.email[0] });
      else
        setError('root', {
          message: isApiError(e) ? e.message : 'Something went wrong. Please try again.',
        });
    }
  });

  if (subscribe.isSuccess) {
    return (
      <p
        role="status"
        className={cn(
          'flex items-center gap-2.5 text-[0.9375rem] font-medium',
          tone === 'dark' ? 'text-text-inverse' : 'text-text',
          className,
        )}
      >
        <CheckCircle2
          aria-hidden="true"
          className={cn('size-5', tone === 'dark' ? 'text-accent-on-dark' : 'text-success')}
        />
        Thanks — you are on the list.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className={className} aria-label="Newsletter signup">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start">
        <Field
          label="Email address"
          hideLabel
          tone={tone === 'dark' ? 'inverse' : 'default'}
          error={errors.email?.message ?? errors.root?.message}
          className="flex-1"
        >
          <Input
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            {...register('email')}
          />
        </Field>
        <Button
          type="submit"
          variant={tone === 'dark' ? 'inverse' : 'primary'}
          loading={subscribe.isPending}
          className="sm:mt-0"
        >
          Subscribe
        </Button>
      </div>
    </form>
  );
}
