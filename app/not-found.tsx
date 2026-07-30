import Link from 'next/link';

export default function NotFound() {
  return (
    <main
      style={{
        display: 'grid',
        placeItems: 'center',
        minHeight: '100dvh',
        padding: 'var(--space-5)',
        textAlign: 'center',
      }}
    >
      <div style={{ display: 'grid', gap: 'var(--space-3)', justifyItems: 'center' }}>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--step--2)',
            letterSpacing: 'var(--tracking-wide)',
            color: 'var(--text-mute)',
          }}
        >
          404
        </span>
        <h1 style={{ fontSize: 'var(--step-2)', fontWeight: 500 }}>Nothing at this address</h1>
        <Link href="/" style={{ color: 'var(--accent)', fontSize: 'var(--step--1)' }}>
          Back to the board
        </Link>
      </div>
    </main>
  );
}
