import { template as _$template } from "solid-js/web";
import { setStyleProperty as _$setStyleProperty } from "solid-js/web";
import { createComponent as _$createComponent } from "solid-js/web";
import { memo as _$memo } from "solid-js/web";
var _tmpl$ = /*#__PURE__*/_$template(`<svg xmlns=http://www.w3.org/2000/svg viewBox="0 0 24 24"style=pointer-events:none><title>check-bold</title><path fill=green d=M9,20.42L2.79,14.21L5.62,11.38L9,14.77L18.88,4.88L21.71,7.71L9,20.42Z>`),
  _tmpl$2 = /*#__PURE__*/_$template(`<svg xmlns=http://www.w3.org/2000/svg viewBox="0 0 24 24"style=pointer-events:none><path fill=currentColor d="M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z">`);
import { createSignal } from "solid-js";
import { Button } from "./Button";
export function ClipboardButton(props) {
  const [copied, setCopied] = createSignal(false);
  return _$createComponent(Button, {
    onClick: () => {
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
      props.onClick();
    },
    get children() {
      return _$memo(() => !!copied())() ? (() => {
        var _el$ = _tmpl$();
        _$setStyleProperty(_el$, "width", "16px");
        _$setStyleProperty(_el$, "height", "16px");
        return _el$;
      })() : (() => {
        var _el$2 = _tmpl$2();
        _$setStyleProperty(_el$2, "width", "16px");
        _$setStyleProperty(_el$2, "height", "16px");
        return _el$2;
      })();
    }
  });
}