'use client';

import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { cn } from '@/lib/utils';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  maxWidthClassName?: string;
  children: React.ReactNode;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  maxWidthClassName = 'max-w-lg',
  children,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-slate-950/50 backdrop-blur-[1px]"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            className={cn(
              'relative z-10 max-h-[90vh] w-full overflow-y-auto rounded-xl border border-line bg-surface p-6 text-ink shadow-xl',
              maxWidthClassName
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="modal-title" className="text-base font-semibold text-ink">
                  {title}
                </h2>
                {description ? (
                  <p className="mt-1 text-xs leading-relaxed text-ink-muted">{description}</p>
                ) : null}
              </div>
              <IconButton label="Close dialog" variant="ghost" size="sm" onClick={onClose}>
                <X className="h-4 w-4" />
              </IconButton>
            </div>
            <div className="mt-5">{children}</div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
