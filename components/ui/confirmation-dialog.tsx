'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

export interface ConfirmationDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'warning' | 'default';
  details?: string[];
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  details,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmationDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} title={title} maxWidthClassName="max-w-md">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
              tone === 'danger'
                ? 'border-status-danger/30 bg-status-danger/10 text-status-danger'
                : 'border-status-warning/30 bg-status-warning/10 text-status-warning'
            }`}
          >
            <AlertTriangle className="h-4 w-4" />
          </div>
          <p className="text-sm leading-relaxed text-ink-muted">{description}</p>
        </div>

        {details && details.length > 0 ? (
          <ul className="space-y-1.5 rounded-lg border border-line bg-surface-muted p-3 text-xs text-ink">
            {details.map((detail, idx) => (
              <li key={idx} className="leading-relaxed">
                {detail}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex items-center justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
