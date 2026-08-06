import { AuthShell } from '@/features/auth/AuthShell';
import { ResetPasswordForm } from '@/features/auth/ResetPasswordForm';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string }>;
}) {
  const { token, email } = await searchParams;

  if (!token || !email) {
    return (
      <AuthShell title="Reset your password" subtitle="This link is missing information.">
        <a href="/forgot-password">Request a new link</a>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password" subtitle="This link is valid for one use.">
      <ResetPasswordForm email={email} token={token} />
    </AuthShell>
  );
}
