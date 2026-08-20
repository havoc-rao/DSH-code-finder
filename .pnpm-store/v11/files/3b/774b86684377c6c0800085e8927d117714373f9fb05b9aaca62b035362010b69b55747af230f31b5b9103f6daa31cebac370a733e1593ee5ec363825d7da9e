import { template as _$template } from "solid-js/web";
import { delegateEvents as _$delegateEvents } from "solid-js/web";
import { className as _$className } from "solid-js/web";
import { effect as _$effect } from "solid-js/web";
import { setStyleProperty as _$setStyleProperty } from "solid-js/web";
import { insert as _$insert } from "solid-js/web";
import { createComponent as _$createComponent } from "solid-js/web";
var _tmpl$ = /*#__PURE__*/_$template(`<div><div class=p-1><div class="flex justify-between items-center"></div><div class="flex gap-2 justify-between mt-4"><button class="bg-slate-100 py-1 px-2 rounded hover:bg-slate-300 active:bg-slate-200 cursor-pointer text-xs">Reset settings</button><button class="bg-red-50 py-1 px-2 rounded hover:bg-red-200 active:bg-red-100 cursor-pointer text-xs text-red-800 flex gap-1"><svg viewBox="0 0 24 24"><path fill=currentColor d="M16.56,5.44L15.11,6.89C16.84,7.94 18,9.83 18,12A6,6 0 0,1 12,18A6,6 0 0,1 6,12C6,9.83 7.16,7.94 8.88,6.88L7.44,5.44C5.36,6.88 4,9.28 4,12A8,8 0 0,0 12,20A8,8 0 0,0 20,12C20,9.28 18.64,6.88 16.56,5.44M13,3H11V13H13"></path></svg> Disable Locator`);
import { cleanOptions } from "@locator/shared";
import { createMemo } from "solid-js";
import { bannerClasses } from "../functions/bannerClasses";
import { isExtension } from "../functions/isExtension";
import LogoIcon from "./LogoIcon";
import { OptionsCloseButton } from "./OptionsCloseButton";
import { useOptions } from "../functions/optionsStore";
import { LinkOptions } from "./LinkOptions";
import { getElementInfo } from "../adapters/getElementInfo";
export function Options(props) {
  const options = useOptions();
  const elLinkProps = createMemo(() => props.currentElement ? getElementInfo(props.currentElement, props.adapterId)?.thisElement.link || null : null);
  return (() => {
    var _el$ = _tmpl$(),
      _el$2 = _el$.firstChild,
      _el$3 = _el$2.firstChild,
      _el$4 = _el$3.nextSibling,
      _el$5 = _el$4.firstChild,
      _el$6 = _el$5.nextSibling,
      _el$7 = _el$6.firstChild;
    _$insert(_el$3, _$createComponent(LogoIcon, {}), null);
    _$insert(_el$3, _$createComponent(OptionsCloseButton, {
      onClick: () => props.onClose()
    }), null);
    _$insert(_el$2, _$createComponent(LinkOptions, {
      get linkProps() {
        return elLinkProps();
      },
      get adapterId() {
        return props.adapterId;
      },
      get targets() {
        return props.targets;
      }
    }), _el$4);
    _el$5.$$click = () => {
      cleanOptions();
      props.onClose();
    };
    _el$6.$$click = () => {
      if (isExtension()) {
        options.setOptions({
          disabled: true
        });
        props.onClose();
      } else {
        props.showDisableDialog();
      }
    };
    _$setStyleProperty(_el$7, "width", "16px");
    _$setStyleProperty(_el$7, "height", "16px");
    _$effect(() => _$className(_el$, bannerClasses() + " w-[560px] max-w-full overflow-hidden"));
    return _el$;
  })();
}
_$delegateEvents(["click"]);