import { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router';
import { MailCheck, MailX } from 'lucide-react';
import { useAuth } from '@/app/auth';
import { Button, Container, EmptyState, Spinner } from '@/design';
import { useSeo } from '@/hooks/useSeo';
import { useVerifyEmail } from '@/lib/api/account';
import { describeError } from '@/lib/api/errors';

/** Landing page for the link in the confirmation email: `/verify-email?token=…`. Works signed out, too. */
export default function VerifyEmailPage() {
  useSeo({ title: 'Confirm your email', noindex: true });
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { isAuthenticated } = useAuth();
  const verify = useVerifyEmail();
  const started = useRef(false);

  useEffect(() => {
    // One attempt per visit: the token is single-purpose and the endpoint is idempotent anyway.
    if (token && !started.current) {
      started.current = true;
      verify.mutate(token);
    }
  }, [token, verify]);

  return (
    <Container size="narrow" className="py-16">
      {!token ? (
        <EmptyState
          as="h1"
          icon={<MailX aria-hidden="true" />}
          title="This link is incomplete"
          description="Open the link from your confirmation email again, or request a new one from your profile."
          action={
            <Button asChild>
              <Link to="/account">Go to your profile</Link>
            </Button>
          }
        />
      ) : verify.isSuccess ? (
        <EmptyState
          as="h1"
          icon={<MailCheck aria-hidden="true" />}
          title="Your email address is confirmed"
          description="Thank you. You will now receive order updates at this address."
          action={
            <Button asChild>
              <Link to={isAuthenticated ? '/account' : '/login'}>
                {isAuthenticated ? 'Go to your profile' : 'Sign in'}
              </Link>
            </Button>
          }
        />
      ) : verify.isError ? (
        <EmptyState
          as="h1"
          icon={<MailX aria-hidden="true" />}
          title="We could not confirm your email"
          description={`${describeError(verify.error).message} The link may have expired. Sign in and request a new one from your profile.`}
          action={
            <Button asChild>
              <Link to={isAuthenticated ? '/account' : '/login?next=%2Faccount'}>
                {isAuthenticated ? 'Go to your profile' : 'Sign in'}
              </Link>
            </Button>
          }
        />
      ) : (
        <div role="status" className="flex flex-col items-center gap-3 py-12 text-text-muted">
          <Spinner className="size-6" label={null} />
          <p>Confirming your email address…</p>
        </div>
      )}
    </Container>
  );
}
