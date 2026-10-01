'use client';
import { useEffect, useRef, useState } from 'react';
import type { Asset } from '@/types/asset';
import { isVideoCapture } from './trim';
import { captureTrimForExport } from './persist-trim';
import { downloadBlob } from '@/lib/persist/client';

/** Both inspectors use one export path; closing/switching cancels work before download. */
export function useMediaDownload(asset: Asset | null | undefined, open: boolean, note: (message: string | null) => void) {
  const active = useRef<AbortController | null>(null);
  const [busy,setBusy] = useState(false);
  const [label,setLabel] = useState('Download');
  useEffect(() => () => { active.current?.abort(); active.current=null; setBusy(false); setLabel('Download'); },[asset?.itemId,open]);
  async function download() {
    if (!asset?.srcUrl || active.current) return;
    const controller = new AbortController(); active.current=controller;
    const {signal}=controller;
    // Freeze this click's range. Later preview edits belong to the next export.
    const trim = isVideoCapture(asset) ? captureTrimForExport(asset.id,asset.captureTrim) : null;
    const edited = trim && (trim.startSec > 0 || trim.endSec < trim.sourceDurationSec);
    setBusy(true);setLabel(edited?'Preparing trimmed export…':'Downloading…');note(null);
    try {
      const response=await fetch(asset.srcUrl,{signal});
      if (!response.ok) throw new Error('Could not download the saved source.');
      if (edited && Number(response.headers.get('content-length')) > 128*1024*1024) throw new Error('This capture is too large to trim in this browser.');
      let blob=await response.blob();
      let extension=asset.srcUrl.split('.').pop()?.split(/[?#]/)[0] || 'bin';
      if (edited) {
        const {exportTrimmedCapture}=await import('./export-trim');
        signal.throwIfAborted();
        const result=await exportTrimmedCapture(blob,trim,signal,fraction=>{ if (!signal.aborted && active.current===controller) setLabel(`Exporting trim ${Math.round(fraction*100)}%`); });
        blob=result.blob;extension=result.extension;
      }
      signal.throwIfAborted();
      const safeName=asset.title.replace(/[<>:"/\\|?*]/g,'_');
      downloadBlob(blob,`${safeName}${edited?' — trimmed':''}.${extension}`);
      if (edited) note('Trimmed export ready');
    } catch(error) {
      if (!signal.aborted) note(error instanceof Error?error.message:'Download failed');
    } finally {
      if (active.current===controller) {active.current=null;setBusy(false);setLabel('Download');}
    }
  }
  return {download,busy,label};
}
