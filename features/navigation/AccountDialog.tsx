'use client';

import { useEffect, useState } from 'react';
import { Dialog, Button } from '@/components/ui';
import { getAccountInfoAction, logoutAction, type AccountInfo } from '@/features/auth/actions';
import s from '../features.module.css';

interface AccountDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Read-only account summary — basic info plus sign-out, the same shape as
 * the account popover in most modern SaaS apps (Vercel, Linear, Notion):
 * click your name, see who you're signed in as and how, sign out from the
 * same place. Editing (changing name/email/password) isn't in scope here;
 * see this file's own trailing comment for the recommended next step.
 */
export function AccountDialog({ open, onClose }: AccountDialogProps) {
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    getAccountInfoAction().then((result) => {
      if (!cancelled) {
        setInfo(result);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Dialog
      open={open}
      title="Account"
      onClose={onClose}
      footer={
        <>
          <form action={logoutAction}>
            <Button type="submit" variant="ghost">
              Log out
            </Button>
          </form>
          <Button variant="accent" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      {loading && !info ? (
        <p className={s.notice}>Loading…</p>
      ) : !info ? (
        <p className={s.notice}>Couldn&rsquo;t load account details.</p>
      ) : (
        <div className={s.shortcutList}>
          <div className={s.shortcutRow}>
            <span>Name</span>
            <span className={s.shortcutKey}>{info.name}</span>
          </div>
          <div className={s.shortcutRow}>
            <span>Email</span>
            <span className={s.shortcutKey}>{info.email}</span>
          </div>
          {info.username && (
            <div className={s.shortcutRow}>
              <span>Username</span>
              <span className={s.shortcutKey}>{info.username}</span>
            </div>
          )}
          <div className={s.shortcutRow}>
            <span>Member since</span>
            <span className={s.shortcutKey}>
              {new Date(info.createdAt).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </span>
          </div>
          <div className={s.shortcutRow}>
            <span>Sign-in methods</span>
            <span className={s.shortcutKey}>
              {[info.hasPassword && 'Password', info.githubLinked && 'GitHub']
                .filter(Boolean)
                .join(' + ') || 'None'}
            </span>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/*
 * Recommendation for the next iteration of this panel, once there's
 * appetite for it — not built now, since it's a materially bigger scope
 * (its own server actions, inline validation, re-auth-to-change-email
 * flows) than "show basic info," which is what was actually asked for:
 *
 * - Editable name/username inline (click to edit, save on blur) — this is
 *   the single highest-value addition, and how Linear/Notion/Vercel all
 *   handle it: no separate "edit mode," the field just becomes editable.
 * - "Change password" as a link that reuses the existing reset-password
 *   flow rather than a new form — send the same reset email instead of
 *   building a second password-change code path that has to independently
 *   stay correct.
 * - Email changes need their own re-verification step (send a
 *   confirmation to the NEW address before it takes effect) — this is
 *   worth real design attention on its own; don't bolt it on quickly.
 * - "Connect GitHub" / "Disconnect GitHub" as an explicit action once
 *   hasPassword is true (so disconnecting never leaves an account with no
 *   way to sign in at all).
 * - A "Log out everywhere" button, distinct from the plain "Log out"
 *   here — this already has a real, working mechanism to sit on top of:
 *   it's exactly what resetPasswordAction already does to users.revokedAt.
 */
