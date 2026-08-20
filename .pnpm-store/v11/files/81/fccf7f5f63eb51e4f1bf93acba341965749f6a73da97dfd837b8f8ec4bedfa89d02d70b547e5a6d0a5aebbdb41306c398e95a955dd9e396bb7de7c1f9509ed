import { template as _$template } from "solid-js/web";
import { delegateEvents as _$delegateEvents } from "solid-js/web";
import { setAttribute as _$setAttribute } from "solid-js/web";
import { effect as _$effect } from "solid-js/web";
import { insert as _$insert } from "solid-js/web";
var _tmpl$ = /*#__PURE__*/_$template(`<a target=_blank class=underline>`);
export function LinkThatWorksWithOption(props) {
  return (() => {
    var _el$ = _tmpl$();
    _el$.$$click = e => {
      e.preventDefault();
      window.open(props.href, "_blank");
    };
    _$insert(_el$, () => props.children);
    _$effect(() => _$setAttribute(_el$, "href", props.href));
    return _el$;
  })();
}
_$delegateEvents(["click"]);