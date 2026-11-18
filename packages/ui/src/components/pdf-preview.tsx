import { cn } from "../lib/utils";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
// oxlint-disable-next-line import/default -- Vite's ?url suffix supplies the default export.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useState } from "react";

GlobalWorkerOptions.workerSrc = workerUrl;

const RASTER_WIDTH = 1400;

async function rasterize(data: Uint8Array): Promise<string[]> {
  const task = getDocument({ data: data.slice() });
  const pdf = await task.promise;

  try {
    const pages: string[] = [];

    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: RASTER_WIDTH / base.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));

      if (blob) pages.push(URL.createObjectURL(blob));
    }

    return pages;
  } finally {
    await task.destroy();
  }
}

/** Pages of a PDF as images; the previous render stays up until the next one is ready. */
export function PdfPreview({
  data,
  label,
  className,
  onRendered,
}: {
  data: Uint8Array | null;
  label: string;
  className?: string;
  onRendered?: (pageCount: number) => void;
}) {
  const [pages, setPages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;

    let cancelled = false;

    rasterize(data).then(
      (next) => {
        if (cancelled) {
          for (const url of next) URL.revokeObjectURL(url);

          return;
        }

        setError(null);
        onRendered?.(next.length);

        setPages((previous) => {
          for (const url of previous) URL.revokeObjectURL(url);

          return next;
        });
      },
      (cause: unknown) => !cancelled && setError((cause as Error).message),
    );

    return () => {
      cancelled = true;
    };
  }, [data, onRendered]);

  if (error) {
    return <p className="m-0 p-6 text-sm text-destructive">Couldn't show this PDF. {error}</p>;
  }

  if (pages.length === 0) {
    return (
      <div className={cn("grid gap-4", className)}>
        <div className="aspect-[8.5/11] w-full animate-pulse rounded-sm bg-card ring-1 ring-black/5" />
      </div>
    );
  }

  return (
    <div className={cn("grid gap-4", className)}>
      {pages.map((url, i) => (
        <img
          key={url}
          src={url}
          alt={`${label}, page ${i + 1} of ${pages.length}`}
          className="w-full rounded-sm bg-white shadow-(--card-shadow) ring-1 ring-black/5"
        />
      ))}
    </div>
  );
}
