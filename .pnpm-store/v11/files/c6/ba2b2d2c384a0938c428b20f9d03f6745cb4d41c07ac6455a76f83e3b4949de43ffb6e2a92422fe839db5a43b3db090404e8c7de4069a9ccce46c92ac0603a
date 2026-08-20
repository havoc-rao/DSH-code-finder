import { template as _$template } from "solid-js/web";
import { delegateEvents as _$delegateEvents } from "solid-js/web";
import { insert as _$insert } from "solid-js/web";
var _tmpl$ = /*#__PURE__*/_$template(`<button class="py-1 px-1 hover:bg-white/30 pointer hover:text-gray-100 rounded">`);
export function Button(props) {
  return (() => {
    var _el$ = _tmpl$();
    _el$.$$click = e => {
      e.preventDefault();
      e.stopPropagation();
      props.onClick();
    };
    _$insert(_el$, () => props.children);
    return _el$;
  })();
}
_$delegateEvents(["click"]);