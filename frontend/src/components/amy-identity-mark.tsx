'use client';

import React from 'react';
import { Crown } from 'lucide-react';

type AmyIdentityMarkProps = {
  size?: 'sm' | 'md';
  className?: string;
};

const SIZE_CLASS: Record<NonNullable<AmyIdentityMarkProps['size']>, string> = {
  sm: 'amy-identity-mark--sm',
  md: 'amy-identity-mark--md',
};

export function AmyIdentityMark({ size = 'md', className }: AmyIdentityMarkProps) {
  const sizeClass = SIZE_CLASS[size];
  const rootClassName = ['amy-identity-mark', sizeClass, className].filter(Boolean).join(' ');

  return (
    <div className={rootClassName} aria-hidden="true">
      <span className="amy-identity-mark__halo" />
      <span className="amy-identity-mark__core">
        <Crown className="h-3.5 w-3.5 text-cyan-50/95" strokeWidth={2.2} />
      </span>
      <span className="amy-identity-mark__knight">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-cyan-100/95">
          <path d="M7.2 20h9.6v-1.6h-1.3l-.7-2.3-2.4-1.6c-.9-.6-1.5-1.5-1.8-2.5l3.2.4c.5.1 1-.2 1.2-.7l1.2-2.8c.2-.5 0-1-.4-1.3l-2.4-1.6 1.1-1.4-.9-.8L11 5.8 9.2 5l-.7 1.8 1.1.7-1.8 2.5L6.2 13l.6 1.4 2.2-1.3c.2.9.8 1.7 1.6 2.2l2.2 1.5.5 1.6H7.2z" />
        </svg>
      </span>
      <span className="amy-identity-mark__pulse" />
    </div>
  );
}
