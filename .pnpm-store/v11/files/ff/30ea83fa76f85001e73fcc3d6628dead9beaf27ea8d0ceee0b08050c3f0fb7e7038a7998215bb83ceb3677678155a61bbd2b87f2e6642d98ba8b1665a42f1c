import { template as _$template } from "solid-js/web";
import { delegateEvents as _$delegateEvents } from "solid-js/web";
import { memo as _$memo } from "solid-js/web";
import { setStyleProperty as _$setStyleProperty } from "solid-js/web";
import { className as _$className } from "solid-js/web";
import { effect as _$effect } from "solid-js/web";
import { insert as _$insert } from "solid-js/web";
import { createComponent as _$createComponent } from "solid-js/web";
var _tmpl$ = /*#__PURE__*/_$template(`<div><div class="text-sm mt-2 mb-1">Go to component code with <!> + <div class="inline-block px-1 py-0.5 border border-slate-200 rounded">click</div> </div><div class="text-xs mt-2 mb-1 text-gray-600 flex gap-1"><a class="underline cursor-pointer"href=https://www.locatorjs.com target=_blank>What is Locator?</a><a class="underline cursor-pointer">Stop showing this popup`),
  _tmpl$2 = /*#__PURE__*/_$template(`<div class="inline-block px-1 py-0.5 border border-slate-200 rounded">`);
import { modifiersTitles } from "@locator/shared";
import { createEffect, createSignal, For } from "solid-js";
import { bannerClasses } from "../functions/bannerClasses";
import BannerHeader from "./BannerHeader";
import { getMouseModifiers } from "../functions/isCombinationModifiersPressed";
import { useOptions } from "../functions/optionsStore";
export function IntroInfo(props) {
  const options = useOptions();
  const [showIntro, setShowIntro] = createSignal(true);
  setTimeout(() => {
    setShowIntro(false);
  }, 5000);
  createEffect(() => {
    if (props.hide && showIntro()) {
      setShowIntro(false);
    }
  });
  const modifiers = () => getMouseModifiers();
  return (() => {
    var _el$ = _tmpl$(),
      _el$2 = _el$.firstChild,
      _el$3 = _el$2.firstChild,
      _el$6 = _el$3.nextSibling,
      _el$5 = _el$6.nextSibling,
      _el$7 = _el$2.nextSibling,
      _el$8 = _el$7.firstChild,
      _el$9 = _el$8.nextSibling;
    _$insert(_el$, _$createComponent(BannerHeader, {
      get openOptions() {
        return props.openOptions;
      },
      get adapter() {
        return props.adapter;
      }
    }), _el$2);
    _$insert(_el$2, _$createComponent(For, {
      get each() {
        return Object.keys(modifiers());
      },
      children: (key, i) => {
        return [_$memo(() => i() === 0 ? "" : " + "), (() => {
          var _el$0 = _tmpl$2();
          _$insert(_el$0, () => modifiersTitles[key]);
          return _el$0;
        })()];
      }
    }), _el$6);
    _el$9.$$click = () => {
      options.setOptions({
        showIntro: false
      });
    };
    _$effect(_p$ => {
      var _v$ = bannerClasses(),
        _v$2 = showIntro() ? "12px" : "-120px";
      _v$ !== _p$.e && _$className(_el$, _p$.e = _v$);
      _v$2 !== _p$.t && _$setStyleProperty(_el$, "bottom", _p$.t = _v$2);
      return _p$;
    }, {
      e: undefined,
      t: undefined
    });
    return _el$;
  })();
}
_$delegateEvents(["click"]);