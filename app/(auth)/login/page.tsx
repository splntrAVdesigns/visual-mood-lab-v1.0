import { AuthShell } from '@/features/auth/AuthShell';
import { LoginForm } from '@/features/auth/LoginForm';
import { safeCallbackUrl } from '@/lib/auth/safe-redirect';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;

  return (
    <AuthShell
      title="Log in"
      subtitle="Enter your credentials to get back to your board."
    >
      <LoginForm callbackUrl={safeCallbackUrl(callbackUrl)} />
    </AuthShell>
  );
}
