'use client';

import React from 'react';
import { GripVertical } from 'lucide-react';

export function SortableRow({ id, className, onMove, children }: {
  id: string;
  className?: string;
  onMove: (draggedId: string, targetId: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className={className} onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => { event.preventDefault(); const dragged = event.dataTransfer.getData('text/plain'); if (dragged && dragged !== id) onMove(dragged, id); }}>
      <button type="button" draggable aria-label="Drag to change priority"
        onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id); }}
        className="mr-2 inline-flex h-9 w-7 shrink-0 cursor-grab items-center justify-center rounded text-ink-muted hover:bg-surface-muted hover:text-ink active:cursor-grabbing">
        <GripVertical className="h-4 w-4" aria-hidden="true" />
      </button>
      {children}
    </div>
  );
}

export function reorderIds<T extends { id: string }>(items: T[], fromId: string, toId: string): T[] {
  const next = [...items];
  const from = next.findIndex((item) => item.id === fromId);
  const to = next.findIndex((item) => item.id === toId);
  if (from < 0 || to < 0 || from === to) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
