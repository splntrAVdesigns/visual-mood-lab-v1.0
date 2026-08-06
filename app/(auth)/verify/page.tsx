import { AuthShell } from '@/features/auth/AuthShell';
import { VerifyForm } from '@/features/auth/VerifyForm';

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string }>;
}) {
  const { token, email } = await searchParams;

  if (!token || !email) {
    return (
      <AuthShell title="Email verification" subtitle="This link is missing information.">
        <a href="/login">Back to log in</a>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Confirm your email" subtitle="One click to finish creating your account.">
      <VerifyForm email={email} token={token} />
    </AuthShell>
  );
}
