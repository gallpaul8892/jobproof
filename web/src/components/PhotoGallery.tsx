import { useCallback, useEffect, useRef, useState } from "react";
import { formatDateTime, photoStageLabel, type PhotoStage, type ReportPhoto } from "@jobproof/shared";

const STAGES: PhotoStage[] = ["before", "during", "after"];

function PhotoImage({
  src,
  alt,
  className,
  onFailed,
}: {
  src: string;
  alt: string;
  className?: string;
  onFailed?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className={`photo-missing ${className ?? ""}`} role="img" aria-label={alt}>
        Photo unavailable
      </span>
    );
  }
  return <img src={src} alt={alt} className={className} onError={() => {
        setFailed(true);
        onFailed?.();
      }} />;
}

function Lightbox({
  photos,
  index,
  onIndex,
  onClose,
  onImageError,
  version,
}: {
  onImageError?: () => void;
  version: number;
  photos: ReportPhoto[];
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const open = index !== null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const photo = index === null ? undefined : photos[index];
  const count = photos.length;
  const go = (delta: number) => {
    if (index !== null) onIndex((index + delta + count) % count);
  };

  return (
    <dialog
      ref={ref}
      className="lightbox"
      data-testid="lightbox"
      aria-label="Photo viewer"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
      onKeyDown={(e) => {
        if (count < 2) return;
        if (e.key === "ArrowRight") {
          e.preventDefault();
          go(1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          go(-1);
        }
      }}
    >
      {photo && index !== null && (
        <div className="lightbox-body">
          <div className="lightbox-top">
            <p className="lightbox-meta">
              <span className={`stage stage-${photo.stage}`}>{photoStageLabel(photo.stage)}</span>
              <span data-testid="lightbox-position" aria-live="polite">
                {index + 1} of {count}
              </span>
            </p>
            <button
              type="button"
              ref={closeButton}
              className="btn"
              onClick={() => ref.current?.close()}
              autoFocus
            >
              Close
            </button>
          </div>
          <div className="lightbox-stage">
            <button
              type="button"
              className="btn lightbox-nav"
              onClick={() => go(-1)}
              disabled={count < 2}
              aria-label="Previous photo"
            >
              <span aria-hidden="true">‹</span>
            </button>
            <PhotoImage
              key={`${photo.url}:${version}`}
              src={photo.url}
              alt={photo.caption}
              className="lightbox-img"
              onFailed={onImageError}
            />
            <button
              type="button"
              className="btn lightbox-nav"
              onClick={() => go(1)}
              disabled={count < 2}
              aria-label="Next photo"
            >
              <span aria-hidden="true">›</span>
            </button>
          </div>
          <p className="lightbox-caption" data-testid="lightbox-caption">
            {photo.caption}
          </p>
          <p className="muted small">{formatDateTime(photo.taken_at)}</p>
        </div>
      )}
    </dialog>
  );
}

/**
 * `onImageError` runs when an image fails to load (typically an expired signed URL); the caller
 * refetches the report so fresh URLs arrive. Images are keyed by URL so they retry on new URLs.
 */
export function PhotoGallery({
  photos,
  onImageError,
  version = 0,
}: {
  photos: ReportPhoto[];
  onImageError?: () => void;
  /** Changes when the report is refetched, so images that failed are tried again. */
  version?: number;
}) {
  const [index, setIndex] = useState<number | null>(null);
  const opener = useRef<number | null>(null);
  const thumbs = useRef<(HTMLButtonElement | null)[]>([]);

  const close = useCallback(() => {
    setIndex(null);
    const i = opener.current;
    // The native dialog restores focus to the opener; this covers browsers that do not.
    if (i !== null) queueMicrotask(() => thumbs.current[i]?.focus());
  }, []);

  if (photos.length === 0) {
    return (
      <p className="muted" data-testid="no-photos">
        No photos were submitted with this report.
      </p>
    );
  }

  return (
    <>
      {STAGES.map((stage) => {
        const group = photos.map((p, i) => ({ p, i })).filter(({ p }) => p.stage === stage);
        if (group.length === 0) return null;
        return (
          <div key={stage} className="photo-group" data-testid={`photos-${stage}`}>
            <h3>
              {photoStageLabel(stage)} <span className="count">({group.length})</span>
            </h3>
            <ul className="photo-grid">
              {group.map(({ p, i }) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="photo-thumb"
                    data-testid="photo-thumb"
                    aria-haspopup="dialog"
                    ref={(el) => {
                      thumbs.current[i] = el;
                    }}
                    onClick={() => {
                      opener.current = i;
                      setIndex(i);
                    }}
                  >
                    <PhotoImage key={`${p.thumb_url}:${version}`} src={p.thumb_url} alt="" className="photo-img" onFailed={onImageError} />
                    <span className="photo-caption">{p.caption}</span>
                    <span className="photo-time">{formatDateTime(p.taken_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <Lightbox photos={photos} index={index} onIndex={setIndex} onClose={close} onImageError={onImageError} version={version} />
    </>
  );
}
