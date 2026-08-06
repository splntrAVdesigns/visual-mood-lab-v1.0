import { AuthShell } from '@/features/auth/AuthShell';
import { ForgotPasswordForm } from '@/features/auth/ForgotPasswordForm';

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter the email on your account and we'll send you a reset link."
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
