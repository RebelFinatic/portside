import { ReactNode } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';

export type ConfirmModalProps = {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
};

export default function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  loading = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div
        className={`w-full max-w-md rounded-xl border shadow-2xl bg-[#101010] ${danger ? 'border-red-500/30' : 'border-zinc-800'}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
      >
        <div className="flex items-start justify-between gap-4 p-5 border-b border-zinc-800">
          <div className="flex gap-3 min-w-0">
            {danger && (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-red-500/20 bg-red-500/10 text-red-400">
                <AlertTriangle className="h-5 w-5" />
              </div>
            )}
            <div className="min-w-0">
              <h2 id="confirm-modal-title" className="text-base font-semibold text-white">
                {title}
              </h2>
              <div className="mt-1 text-sm leading-relaxed text-zinc-400">{description}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="shrink-0 p-1 text-zinc-500 hover:text-white transition-colors disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {children && <div className="px-5 pb-2">{children}</div>}

        <div className="flex justify-end gap-3 p-5 border-t border-zinc-800">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading || confirmDisabled}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              danger
                ? 'border border-red-500/30 bg-red-600 text-white hover:bg-red-500'
                : 'border border-orange-600/30 bg-orange-600/10 text-orange-300 hover:bg-orange-600/20'
            }`}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
