'use client';

import React from 'react';
import Image from 'next/image';
import { User } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ProfileAvatarProps {
  name?: string;
  avatarUrl?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_MAP = {
  sm: { container: 'h-8 w-8 text-xs', px: 32, icon: 'h-4 w-4' },
  md: { container: 'h-9 w-9 text-xs', px: 36, icon: 'h-4 w-4' },
  lg: { container: 'h-14 w-14 text-base', px: 56, icon: 'h-6 w-6' },
} as const;

function getInitials(name?: string): string {
  const trimmed = name?.trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function ProfileAvatar({ name, avatarUrl, size = 'md', className }: ProfileAvatarProps) {
  const spec = SIZE_MAP[size];
  const initials = getInitials(name);

  return (
    <div
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-surface-muted font-semibold text-ink',
        spec.container,
        className
      )}
    >
      {avatarUrl ? (
        <Image
          src={avatarUrl}
          alt={name ? `${name} profile photo` : 'User profile photo'}
          width={spec.px}
          height={spec.px}
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
        />
      ) : initials ? (
        <span aria-hidden="true">{initials}</span>
      ) : (
        <User className={cn('text-ink-muted', spec.icon)} aria-hidden="true" />
      )}
    </div>
  );
}
