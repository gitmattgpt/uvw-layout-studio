export type ExportFileSink = (blob: Blob, filename: string) => void;

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Safari needs time to hand the blob to its download manager.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function saveFile(blob: Blob, filename: string) {
  const picker = (window as Window & {
    showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{
      createWritable: () => Promise<{ write: (blob: Blob) => Promise<void>; close: () => Promise<void> }>;
    }>;
  }).showSaveFilePicker;
  if (picker) {
    const handle = await picker.call(window, { suggestedName: filename });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }
  const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
  if (navigator.canShare?.({ files: [file] }) && navigator.share) {
    await navigator.share({ files: [file] });
    return;
  }
  downloadBlob(blob, filename);
}