import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import styles from './atelier.module.css';

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label?: ReactNode;
  hint?: ReactNode;
  containerClassName?: string;
};

export const TextField = forwardRef<HTMLInputElement, Props>(function TextField(
  { label, hint, id, containerClassName, className, ...rest },
  ref,
) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <label
      htmlFor={inputId}
      className={[styles.field, containerClassName].filter(Boolean).join(' ')}
    >
      {label != null && (
        <span className={styles.fieldLabel}>{label}</span>
      )}
      <input
        {...rest}
        id={inputId}
        ref={ref}
        className={[styles.input, className].filter(Boolean).join(' ')}
      />
      {hint}
    </label>
  );
});
