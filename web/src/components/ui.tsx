import { useEffect, type ReactNode } from 'react';
import { STATUS_LABELS } from '../labels';

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <span className={`badge badge-${status}`}>{label ?? STATUS_LABELS[status] ?? status}</span>;
}

export function Loading() {
  return <div className="spinner">Carregando…</div>;
}

export function ErrorAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="alert alert-error" role="alert">
      {message}
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
