import { forwardRef, type OptionHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { cn } from '../lib/utils';

type SelectVariant = 'default' | 'compact';

const variantClasses: Record<SelectVariant, string> = {
  default: 'px-3 py-2 text-sm',
  compact: 'px-2 py-1 text-[11px] font-mono',
};

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { variant?: SelectVariant }>(
  ({ className, variant = 'default', children, ...props }, ref) => (
    <select
      ref={ref}
      style={{ colorScheme: 'dark' }}
      className={cn(
        'w-full cursor-pointer appearance-none rounded border border-zinc-700 bg-zinc-900 text-zinc-200 outline-none focus:border-orange-500',
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';

export function SelectOption({ className, children, ...props }: OptionHTMLAttributes<HTMLOptionElement>) {
  return (
    <option className={cn('bg-zinc-900 text-zinc-300', className)} {...props}>
      {children}
    </option>
  );
}
