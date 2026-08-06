import { AuthShell } from '@/features/auth/AuthShell';
import { SignupForm } from '@/features/auth/SignupForm';
import { signupEnabled } from '@/lib/auth/flags';

export default function SignupPage() {
  return (
    <AuthShell
      title="Sign up"
      subtitle="Create an account to start building your own board."
    >
      <SignupForm enabled={signupEnabled} />
    </AuthShell>
  );
}
