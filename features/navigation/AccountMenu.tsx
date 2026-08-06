'use client';

import { Button } from '@/components/ui';
import { logoutAction } from '@/features/auth/actions';
import s from '../features.module.css';

interface AccountMenuProps {
  user: { id: string; name: string } | null;
  onOpenAccount: () => void;
}

/**
 * Name is a button, not a label — clicking it opens AccountDialog (basic
 * account info + sign out), the same "click your name to see account
 * details" pattern most modern SaaS apps use (Vercel, Linear, Notion).
 * "Log out" stays as its own separate, always-visible action next to it
 * rather than being buried a click deeper — signing out is common and
 * urgent enough to deserve not needing the popup at all.
 */
export function AccountMenu({ user, onOpenAccount }: AccountMenuProps) {
  if (!user) return null;

  return (
    <span className={s.accountMenu}>
      <button type="button" className={s.accountName} title={user.name} onClick={onOpenAccount}>
        {user.name}
      </button>
      <form action={logoutAction}>
        <Button type="submit" variant="ghost">
          Log out
        </Button>
      </form>
    </span>
  );
}
