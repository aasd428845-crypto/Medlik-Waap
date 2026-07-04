import { ReactNode } from 'react';

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'تأكيد',
  cancelLabel = 'إلغاء'
}: DialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-card rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="p-6">
          <h3 className="text-lg font-bold text-foreground mb-2">{title}</h3>
          <div className="text-muted-foreground text-sm leading-relaxed">
            {message}
          </div>
        </div>
        <div className="bg-muted/50 px-6 py-4 flex justify-end gap-3 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-foreground bg-background border hover:bg-muted transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className="px-4 py-2 rounded-lg text-sm font-medium text-destructive-foreground bg-destructive hover:bg-destructive/90 transition-colors shadow-sm"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
