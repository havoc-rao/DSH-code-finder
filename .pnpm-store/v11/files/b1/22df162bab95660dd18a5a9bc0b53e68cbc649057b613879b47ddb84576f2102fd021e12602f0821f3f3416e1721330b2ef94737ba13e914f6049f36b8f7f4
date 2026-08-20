import { template as _$template } from "solid-js/web";
import { className as _$className } from "solid-js/web";
import { effect as _$effect } from "solid-js/web";
import { addEventListener as _$addEventListener } from "solid-js/web";
import { insert as _$insert } from "solid-js/web";
import { createComponent as _$createComponent } from "solid-js/web";
var _tmpl$ = /*#__PURE__*/_$template(`<div><div class="flex justify-between items-center"></div><div class="font-medium mt-2">Disable Locator</div><div class="text-sm text-gray-700 mt-1">You will be able to enable Locator again by running \`enableLocator()\` in DevTools console.</div><div class="flex justify-end"><button class="bg-slate-100 py-2 px-4 rounded hover:bg-slate-300 active:bg-slate-200 cursor-pointer text-sm">Confirm`);
import { bannerClasses } from "../functions/bannerClasses";
import { useOptions } from "../functions/optionsStore";
import LogoIcon from "./LogoIcon";
import { OptionsCloseButton } from "./OptionsCloseButton";
export function DisableConfirmation(props) {
  const options = useOptions();
  return (() => {
    var _el$ = _tmpl$(),
      _el$2 = _el$.firstChild,
      _el$3 = _el$2.nextSibling,
      _el$4 = _el$3.nextSibling,
      _el$5 = _el$4.nextSibling,
      _el$6 = _el$5.firstChild;
    _$insert(_el$2, _$createComponent(LogoIcon, {}), null);
    _$insert(_el$2, _$createComponent(OptionsCloseButton, {
      onClick: () => props.onClose()
    }), null);
    _$addEventListener(_el$6, "click", () => {
      options.setOptions({
        disabled: true
      });
    });
    _$effect(() => _$className(_el$, bannerClasses() + " w-96"));
    return _el$;
  })();
}