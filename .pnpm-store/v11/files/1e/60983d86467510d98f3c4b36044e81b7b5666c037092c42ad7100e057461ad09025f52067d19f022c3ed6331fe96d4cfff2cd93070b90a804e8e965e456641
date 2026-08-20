import { template as _$template } from "solid-js/web";
import { effect as _$effect } from "solid-js/web";
import { setStyleProperty as _$setStyleProperty } from "solid-js/web";
import { createComponent as _$createComponent } from "solid-js/web";
import { memo as _$memo } from "solid-js/web";
var _tmpl$ = /*#__PURE__*/_$template(`<div class="fixed top-0 left-0 w-screen h-screen flex items-center justify-center"><div class="flex items-center justify-center"style="background-color:rgba(222, 0, 0, 0.3);border-radius:2px;font-size:12px;font-weight:bold;text-shadow:-1px 1px 0 #fff, 1px 1px 0 #fff, 1px -1px 0 #fff, -1px -1px 0 #fff;text-overflow:ellipsis">No source found`);
import { createMemo } from "solid-js";
import { getElementInfo } from "../adapters/getElementInfo";
import { Outline } from "./Outline";
export function MaybeOutline(props) {
  const elInfo = createMemo(() => getElementInfo(props.currentElement, props.adapterId));
  const box = () => props.currentElement.getBoundingClientRect();
  return _$memo(() => _$memo(() => !!elInfo())() ? _$createComponent(Outline, {
    get element() {
      return elInfo();
    },
    get showTreeFromElement() {
      return props.showTreeFromElement;
    },
    get showParentsPath() {
      return props.showParentsPath;
    },
    get copyToClipboard() {
      return props.copyToClipboard;
    },
    get targets() {
      return props.targets;
    }
  }) : (() => {
    var _el$ = _tmpl$(),
      _el$2 = _el$.firstChild;
    _$setStyleProperty(_el$2, "position", "absolute");
    _$setStyleProperty(_el$2, "border", "1px solid rgba(222, 0, 0, 0.5)");
    _$effect(_p$ => {
      var _v$ = box().x + "px",
        _v$2 = box().y + "px",
        _v$3 = box().width + "px",
        _v$4 = box().height + "px";
      _v$ !== _p$.e && _$setStyleProperty(_el$2, "left", _p$.e = _v$);
      _v$2 !== _p$.t && _$setStyleProperty(_el$2, "top", _p$.t = _v$2);
      _v$3 !== _p$.a && _$setStyleProperty(_el$2, "width", _p$.a = _v$3);
      _v$4 !== _p$.o && _$setStyleProperty(_el$2, "height", _p$.o = _v$4);
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined
    });
    return _el$;
  })());
}