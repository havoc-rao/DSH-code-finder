import { template as _$template } from "solid-js/web";
import { delegateEvents as _$delegateEvents } from "solid-js/web";
import { effect as _$effect } from "solid-js/web";
import { setAttribute as _$setAttribute } from "solid-js/web";
import { createComponent as _$createComponent } from "solid-js/web";
import { insert as _$insert } from "solid-js/web";
import { memo as _$memo } from "solid-js/web";
var _tmpl$ = /*#__PURE__*/_$template(`<div class="mt-2 border border-gray-200 rounded p-4 flex flex-col gap-1"><div class="flex justify-between self-stretch text-sm"><div>Link Href Target</div><a class="underline cursor-pointer">`),
  _tmpl$2 = /*#__PURE__*/_$template(`<div class="text-xs text-gray-700">Hot-reloading On some stacks (e.g. Create React App) gets broken when you use _blank as the target. You can change the target to _self to fix this. <br>Some browsers open unnecessary tabs when you use _blank.`),
  _tmpl$3 = /*#__PURE__*/_$template(`<div class="flex flex-col gap-1 py-1">`),
  _tmpl$4 = /*#__PURE__*/_$template(`<div class="flex items-center"><input type=radio class="focus:ring-indigo-200 h-4 w-4 text-indigo-600 border-slate-300 hover:border-slate-400"><label class="ml-2 block text-sm font-medium text-slate-700 hover:text-slate-800">`);
import { For } from "solid-js";
import { HREF_TARGET } from "../consts";
const hrefTargets = ["_blank", "_self"];
export function LinkHrefTarget(props) {
  const selectedTarget = () => props.value || "";
  return (() => {
    var _el$ = _tmpl$(),
      _el$2 = _el$.firstChild,
      _el$3 = _el$2.firstChild,
      _el$4 = _el$3.nextSibling;
    _el$4.$$click = () => {
      if (props.value === undefined) {
        props.onChange(HREF_TARGET);
      } else {
        props.onChange(undefined);
      }
    };
    _$insert(_el$4, () => props.value === undefined ? "edit" : "clear");
    _$insert(_el$, (() => {
      var _c$ = _$memo(() => props.value !== undefined);
      return () => _c$() ? [_tmpl$2(), (() => {
        var _el$6 = _tmpl$3();
        _$insert(_el$6, _$createComponent(For, {
          get each() {
            return Object.entries(hrefTargets);
          },
          children: ([key, target]) => (() => {
            var _el$7 = _tmpl$4(),
              _el$8 = _el$7.firstChild,
              _el$9 = _el$8.nextSibling;
            _el$8.$$click = () => {
              props.onChange(key);
            };
            _$setAttribute(_el$8, "id", key);
            _$setAttribute(_el$9, "for", key);
            _$insert(_el$9, target);
            _$effect(() => _el$8.checked = key === selectedTarget());
            return _el$7;
          })()
        }));
        return _el$6;
      })()] : null;
    })(), null);
    return _el$;
  })();
}
_$delegateEvents(["click"]);