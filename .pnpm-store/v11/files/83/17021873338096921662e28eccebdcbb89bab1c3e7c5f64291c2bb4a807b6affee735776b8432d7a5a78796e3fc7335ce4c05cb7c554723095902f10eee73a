import { template as _$template } from "solid-js/web";
import { delegateEvents as _$delegateEvents } from "solid-js/web";
import { setAttribute as _$setAttribute } from "solid-js/web";
import { effect as _$effect } from "solid-js/web";
import { insert as _$insert } from "solid-js/web";
import { createComponent as _$createComponent } from "solid-js/web";
var _tmpl$ = /*#__PURE__*/_$template(`<div class="bg-white p-4 rounded-xl border-2 border-red-500 shadow-xl cursor-auto pointer-events-auto z-10 max-w-xl max-h-full overflow-auto"><div class="mt-2 mb-4"><h1 class="text-2xl font-bold">Welcome to Locator!</h1><span class=text-sm>Before using Locator, let's try links in your project and fix them if needed.</span></div><div class="mt-4 flex gap-2 justify-between items-center"><div class="text-sm text-gray-600"></div><div class="flex gap-2"><a class="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded">Test link</a><button class="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">Confirm`);
import { useOptions } from "../functions/optionsStore";
import { LinkOptions } from "./LinkOptions";
import { HREF_TARGET } from "../consts";
import { buildLink } from "../functions/buildLink";
export function WelcomeScreen(props) {
  const options = useOptions();
  const currentLink = () => props.originalLinkProps ? buildLink(props.originalLinkProps, props.targets, options, options.getOptions().templateOrTemplateId) : undefined;
  return (() => {
    var _el$ = _tmpl$(),
      _el$2 = _el$.firstChild,
      _el$3 = _el$2.nextSibling,
      _el$4 = _el$3.firstChild,
      _el$5 = _el$4.nextSibling,
      _el$6 = _el$5.firstChild,
      _el$7 = _el$6.nextSibling;
    _$insert(_el$, _$createComponent(LinkOptions, {
      get linkProps() {
        return props.originalLinkProps;
      },
      get adapterId() {
        return props.adapterId;
      },
      get targets() {
        return props.targets;
      }
    }), _el$3);
    _el$7.$$click = () => {
      options.setOptions({
        welcomeScreenDismissed: true
      });
      props.onClose();
    };
    _$effect(_p$ => {
      var _v$ = currentLink(),
        _v$2 = options.getOptions().hrefTarget || HREF_TARGET;
      _v$ !== _p$.e && _$setAttribute(_el$6, "href", _p$.e = _v$);
      _v$2 !== _p$.t && _$setAttribute(_el$6, "target", _p$.t = _v$2);
      return _p$;
    }, {
      e: undefined,
      t: undefined
    });
    return _el$;
  })();
}
_$delegateEvents(["click"]);