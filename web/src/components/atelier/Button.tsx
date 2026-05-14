import {
  forwardRef,
  type ButtonHTMLAttributes,
  type AnchorHTMLAttributes,
  type ReactNode,
} from 'react';
import styles from './atelier.module.css';

type Variant = 'primary' | 'cyan' | 'ghost' | 'danger' | 'bare';
type Size = 'sm' | 'md' | 'lg';

type Common = {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  kbd?: ReactNode;
};

type ButtonProps = Common &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
    children?: ReactNode;
    as?: 'button';
  };

type AnchorProps = Common &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children'> & {
    children?: ReactNode;
    as: 'a';
  };

type Props = ButtonProps | AnchorProps;

function buildClassName({
  variant = 'ghost',
  size = 'md',
  fullWidth,
  className,
}: {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  className?: string;
}) {
  return [
    styles.btn,
    styles[variant],
    size !== 'md' ? styles[size] : '',
    fullWidth ? styles.full : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
}

export const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, Props>(
  function Button(props, ref) {
    const {
      variant = 'ghost',
      size = 'md',
      fullWidth,
      leadingIcon,
      trailingIcon,
      kbd,
      children,
      className,
      ...rest
    } = props as Props & { className?: string };

    const cls = buildClassName({ variant, size, fullWidth, className });
    const content = (
      <>
        {leadingIcon}
        {children && <span>{children}</span>}
        {trailingIcon}
        {kbd != null && <span className={styles.kbd}>{kbd}</span>}
      </>
    );

    if ('as' in rest && rest.as === 'a') {
      const { as: _as, ...anchorRest } = rest as AnchorProps;
      void _as;
      return (
        <a
          {...anchorRest}
          ref={ref as React.Ref<HTMLAnchorElement>}
          className={cls}
        >
          {content}
        </a>
      );
    }

    const { as: _as, ...buttonRest } = rest as ButtonProps;
    void _as;
    return (
      <button
        type={buttonRest.type ?? 'button'}
        {...buttonRest}
        ref={ref as React.Ref<HTMLButtonElement>}
        className={cls}
      >
        {content}
      </button>
    );
  },
);
