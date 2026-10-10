import { Link } from 'react-router';
import { Checkbox, Field, Input, Textarea } from '@/design';

export const NOTES_MAX = 300;

export function DetailsStep({
  notes,
  phone,
  acceptTerms,
  phoneError,
  termsError,
  notesError,
  phoneRequired,
  onNotes,
  onPhone,
  onAcceptTerms,
}: {
  notes: string;
  phone: string;
  acceptTerms: boolean;
  phoneError?: string;
  termsError?: string;
  notesError?: string;
  phoneRequired?: boolean;
  onNotes: (v: string) => void;
  onPhone: (v: string) => void;
  onAcceptTerms: (v: boolean) => void;
}) {
  return (
    <div className="grid gap-5">
      <Field
        label="Notes for the team"
        hint={`Optional. ${NOTES_MAX - notes.length} characters left.`}
        error={notesError}
      >
        <Textarea
          rows={3}
          maxLength={NOTES_MAX}
          value={notes}
          onChange={(e) => onNotes(e.target.value)}
          placeholder="Allergies, how you will recognise us, anything we should know"
        />
      </Field>
      <Field
        label="Phone"
        required={phoneRequired}
        hint="So we can reach you about this order."
        error={phoneError}
      >
        <Input
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => onPhone(e.target.value)}
        />
      </Field>
      <div className="grid gap-1.5">
        <Checkbox
          checked={acceptTerms}
          onCheckedChange={(v) => onAcceptTerms(v === true)}
          invalid={Boolean(termsError)}
          label={
            <>
              I agree to the{' '}
              <Link
                to="/terms"
                target="_blank"
                rel="noopener"
                className="font-medium text-accent-text underline underline-offset-4"
              >
                Terms of Service
              </Link>{' '}
              and the{' '}
              <Link
                to="/refund-policy"
                target="_blank"
                rel="noopener"
                className="font-medium text-accent-text underline underline-offset-4"
              >
                Refund Policy
              </Link>
              .
            </>
          }
        />
        {termsError ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {termsError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
