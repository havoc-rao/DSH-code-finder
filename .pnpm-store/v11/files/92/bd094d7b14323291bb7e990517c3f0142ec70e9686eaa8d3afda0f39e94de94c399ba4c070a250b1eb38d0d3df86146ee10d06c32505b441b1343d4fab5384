import { template as _$template } from "solid-js/web";
import { effect as _$effect } from "solid-js/web";
import { setStyleProperty as _$setStyleProperty } from "solid-js/web";
import { insert as _$insert } from "solid-js/web";
import { memo as _$memo } from "solid-js/web";
var _tmpl$ = /*#__PURE__*/_$template(`<div>`);
export function SimpleNodeOutline(props) {
  const offset = () => props.node.type === "component" ? 2 : 0;
  const box = () => props.node.getBox();
  return (() => {
    var _el$ = _tmpl$();
    _$insert(_el$, (() => {
      var _c$ = _$memo(() => !!box());
      return () => _c$() ? (() => {
        var _el$2 = _tmpl$();
        _$setStyleProperty(_el$2, "position", "fixed");
        _$effect(_p$ => {
          var _v$ = box().x - offset() + "px",
            _v$2 = box().y - offset() + "px",
            _v$3 = box().width + offset() * 2 + "px",
            _v$4 = box().height + offset() * 2 + "px",
            _v$5 = props.node.type === "component" ? "2px solid rgba(200,0,0,1)" : "1px solid rgba(200,0,0,1)",
            _v$6 = props.node.type === "component" ? "5px" : "3px",
            _v$7 = props.node.type === "component" ? 1000 : 10;
          _v$ !== _p$.e && _$setStyleProperty(_el$2, "left", _p$.e = _v$);
          _v$2 !== _p$.t && _$setStyleProperty(_el$2, "top", _p$.t = _v$2);
          _v$3 !== _p$.a && _$setStyleProperty(_el$2, "width", _p$.a = _v$3);
          _v$4 !== _p$.o && _$setStyleProperty(_el$2, "height", _p$.o = _v$4);
          _v$5 !== _p$.i && _$setStyleProperty(_el$2, "border", _p$.i = _v$5);
          _v$6 !== _p$.n && _$setStyleProperty(_el$2, "border-radius", _p$.n = _v$6);
          _v$7 !== _p$.s && _$setStyleProperty(_el$2, "z-index", _p$.s = _v$7);
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined,
          o: undefined,
          i: undefined,
          n: undefined,
          s: undefined
        });
        return _el$2;
      })() : null;
    })());
    return _el$;
  })();
}