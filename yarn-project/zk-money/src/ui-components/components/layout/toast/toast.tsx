import { useEffect, useRef, useState } from 'react';
import { Button, ButtonTheme } from '../../../../ui-components/index.js';
import { CloseMiniIcon } from '../../../../ui-components/components/icons/index.js';
import { bindStyle } from '../../../../ui-components/util/classnames.js';
import { ToastProps, ToastType } from './toast.types.js';
import style from './toast.module.scss';

const cx = bindStyle(style);
const MAX_TEXT_LENGTH = 400;

export function Toast(props: ToastProps) {
  const [collapsed, setCollapsed] = useState(false);
  const hasPrimaryButton = !!props.primaryButton;
  const hasSecondaryButton = !!props.secondaryButton;
  const hasButtons = hasPrimaryButton || hasSecondaryButton;

  const handleCloseToastRef = useRef(() => {
    if (props.onCloseToast && props.index !== undefined) {
      props.onCloseToast(props.index);
    }
  });

  const handleCollapse = () => {
    setCollapsed(prevValue => !prevValue);
  };

  useEffect(() => {
    if (!props.autocloseInMs) {
      return;
    }

    const timeoutRef = setTimeout(() => {
      handleCloseToastRef.current();
    }, props.autocloseInMs);

    return () => {
      clearTimeout(timeoutRef);
    };
  }, [props.autocloseInMs]);

  return (
    <div
      className={cx(
        style.toast,
        props.isHeavy && style.heavy,
        props.type === ToastType.ERROR && style.error,
        props.type === ToastType.WARNING && style.warning,
      )}
    >
      <div className={style.text}>{collapsed ? `${props.text.substring(0, MAX_TEXT_LENGTH)}...` : props.text}</div>
      {hasButtons && (
        <div className={style.buttons}>
          {props.secondaryButton && (
            <Button
              theme={ButtonTheme.Secondary}
              text={props.secondaryButton.text}
              onClick={props.secondaryButton.onClick}
            />
          )}
          {props.primaryButton && (
            <Button theme={ButtonTheme.Primary} text={props.primaryButton.text} onClick={props.primaryButton.onClick} />
          )}
        </div>
      )}
      {props.text.length > MAX_TEXT_LENGTH && (
        <div className={style.collapseButton} onClick={handleCollapse}>
          {collapsed ? 'Show more' : 'Collapse'}
        </div>
      )}
      {props.onCloseToast && props.isClosable && (
        <div
          className={style.closeButton}
          onClick={e => {
            e.preventDefault();
            handleCloseToastRef.current();
          }}
        >
          <CloseMiniIcon />
        </div>
      )}
    </div>
  );
}