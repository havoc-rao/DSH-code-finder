import { template as _$template } from "solid-js/web";
import { insert as _$insert } from "solid-js/web";
import { memo as _$memo } from "solid-js/web";
import { createComponent as _$createComponent } from "solid-js/web";
var _tmpl$ = /*#__PURE__*/_$template(`<div class="flex justify-between gap-2">`);
import LogoIcon from "./LogoIcon";
import { isExtension } from "../functions/isExtension";
import { OpenSettingsButton } from "./OpenSettingsButton";
export default function BannerHeader(props) {
  return (() => {
    var _el$ = _tmpl$();
    _$insert(_el$, _$createComponent(LogoIcon, {}), null);
    _$insert(_el$, (() => {
      var _c$ = _$memo(() => !!props.openOptions);
      return () => _c$() ? _$createComponent(OpenSettingsButton, {
        onClick: () => {
          props.openOptions();
        },
        get title() {
          return isExtension() ? "Project settings" : "Settings";
        }
      }) : null;
    })(), null);
    return _el$;
  })();
}