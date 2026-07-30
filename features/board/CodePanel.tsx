'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, CloseIcon, IconButton } from '@/components/ui';
import type { Asset } from '@/types/asset';
import s from '../features.module.css';

interface CodePanelProps {
  asset: Asset;
  onClose: () => void;
}

/**
 * Source viewer for code assets, shown beside the focused preview.
 *
 * Deliberately NOT inside the inspector drawer: that panel is 320px wide and
 * exists for manipulating parameters. Source is reference material you read
 * and copy, it needs horizontal room, and burying it under "Show advanced"
 * would conflate "advanced controls" with "documentation" — two different
 * intentions behind the same button.
 */
export function CodePanel({ asset, onClose }: CodePanelProps) {
  const [copied, setCopied] = useState(false);

  const source = asset.source ?? '';
  const lines = useMemo(() => source.split('\n'), [source]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
    } catch {
      // Clipboard API needs a secure context; localhost qualifies, but a
      // LAN address over plain http does not. Fall back to selection so the
      // user can still copy manually instead of getting nothing.
      const el = document.getElementById('vml-code-body');
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  };

  const download = () => {
    const ext = asset.type === 'shader' ? 'frag' : 'js';
    const blob = new Blob([source], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${asset.id}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <aside
      className={s.codePanel}
      onClick={(e) => e.stopPropagation()}
      aria-label={`Source for ${asset.title}`}
    >
      <header className={s.codeHeader}>
        <span className={s.codeTitle}>
          {asset.id}.{asset.type === 'shader' ? 'frag' : 'js'}
        </span>
        <span className={s.codeMeta}>{lines.length} lines</span>
        <IconButton label="Close code" icon={<CloseIcon />} onClick={onClose} />
      </header>

      <div className={s.codeScroll}>
        <pre className={s.codeBody} id="vml-code-body">
          <code>
            {lines.map((line, i) => (
              <span key={i} className={s.codeLine}>
                <span className={s.codeLineNo}>{i + 1}</span>
                <span className={s.codeLineText}>{line || ' '}</span>
              </span>
            ))}
          </code>
        </pre>
      </div>

      <footer className={s.codeFooter}>
        <Button variant={copied ? 'accent' : 'outline'} block onClick={copy}>
          {copied ? 'Copied' : 'Copy source'}
        </Button>
        <Button variant="outline" onClick={download}>
          Save
        </Button>
      </footer>
    </aside>
  );
}
