/**
 * The class strings behind every button (see Button.tsx), in their own module so
 * a link that acts as a button (AppLink, <a>) can wear the same look.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
export type ButtonSize = 'sm' | 'md' | 'lg'

const BASE =
  'relative inline-flex select-none items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap ' +
  'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface ' +
  'active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:active:translate-y-0'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand text-white shadow-[0_1px_2px_rgba(15,23,42,0.08),0_4px_12px_-4px_rgba(37,99,235,0.5)] hover:bg-brand-strong enabled:hover:shadow-[0_1px_2px_rgba(15,23,42,0.08),0_6px_16px_-4px_rgba(37,99,235,0.55)]',
  secondary:
    'border border-border-input bg-surface text-text-primary shadow-[0_1px_2px_rgba(15,23,42,0.06)] enabled:hover:border-slate-600 enabled:hover:bg-slate-50',
  ghost: 'text-slate-700 enabled:hover:bg-slate-100 enabled:hover:text-text-primary',
  danger:
    'bg-zone-qizil text-white shadow-[0_1px_2px_rgba(15,23,42,0.08),0_4px_12px_-4px_rgba(190,58,43,0.5)] enabled:hover:bg-zone-qizil-strong',
  success: 'bg-zone-yashil text-white shadow-[0_1px_2px_rgba(15,23,42,0.08)] enabled:hover:bg-zone-yashil-strong',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3 text-sm',
  md: 'min-h-11 px-4 text-sm',
  lg: 'min-h-12 px-5 text-base',
}

/** The same look for a link that acts as a button (AppLink, <a>). */
export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', fullWidth = false): string {
  return [BASE, VARIANTS[variant], SIZES[size], fullWidth ? 'w-full' : ''].join(' ')
}
