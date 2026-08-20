import { template as _$template } from "solid-js/web";
import { effect as _$effect } from "solid-js/web";
import { setStyleProperty as _$setStyleProperty } from "solid-js/web";
import { addEventListener as _$addEventListener } from "solid-js/web";
import { insert as _$insert } from "solid-js/web";
import { createComponent as _$createComponent } from "solid-js/web";
import { memo as _$memo } from "solid-js/web";
var _tmpl$ = /*#__PURE__*/_$template(`<div>`),
  _tmpl$2 = /*#__PURE__*/_$template(`<div style="font-size:12px;border-radius:0px 0px 4px 4px;white-space:nowrap">`);
import { createSignal, For } from "solid-js";
export function RenderNode(props) {
  const [isHovered, setIsHovered] = createSignal(false);
  const offset = () => props.node.type === "component" ? 2 : 0;
  return (() => {
    var _el$ = _tmpl$();
    _$insert(_el$, (() => {
      var _c$ = _$memo(() => !!props.node.box);
      return () => _c$() ? (() => {
        var _el$2 = _tmpl$();
        _$addEventListener(_el$2, "mouseleave", props.node.type === "component" ? () => setIsHovered(false) : undefined);
        _$addEventListener(_el$2, "mouseenter", props.node.type === "component" ? () => setIsHovered(true) : undefined);
        _$setStyleProperty(_el$2, "position", "absolute");
        _$insert(_el$2, (() => {
          var _c$2 = _$memo(() => !!(props.node.type === "component" || props.parentIsHovered));
          return () => _c$2() ? (() => {
            var _el$3 = _tmpl$2();
            _$setStyleProperty(_el$3, "padding", "1px 4px");
            _$setStyleProperty(_el$3, "position", "absolute");
            _$setStyleProperty(_el$3, "height", "20px");
            _$insert(_el$3, () => props.node.name);
            _$effect(_p$ => {
              var _v$8 = props.node.type === "component" ? "rgba(0,200,0,0.2)" : "",
                _v$9 = props.node.type === "component" ? "rgba(50,150,50,1)" : "rgba(150,50,50,1)";
              _v$8 !== _p$.e && _$setStyleProperty(_el$3, "background", _p$.e = _v$8);
              _v$9 !== _p$.t && _$setStyleProperty(_el$3, "color", _p$.t = _v$9);
              return _p$;
            }, {
              e: undefined,
              t: undefined
            });
            return _el$3;
          })() : null;
        })());
        _$effect(_p$ => {
          var _v$ = props.node.box.x - offset() + "px",
            _v$2 = props.node.box.y - offset() + "px",
            _v$3 = props.node.box.width + offset() * 2 + "px",
            _v$4 = props.node.box.height + offset() * 2 + "px",
            _v$5 = isHovered() || props.parentIsHovered ? props.node.type === "component" ? "2px solid rgba(100,0,0,1)" : "1px solid rgba(200,0,0,0.6)" : props.node.type === "component" ? "1px solid rgba(200,0,0,1)" : "1px solid rgba(200,0,0,0.1)",
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
    })(), null);
    _$insert(_el$, _$createComponent(For, {
      get each() {
        return props.node.children;
      },
      children: childNode => {
        return _$createComponent(RenderNode, {
          node: childNode,
          get parentIsHovered() {
            return isHovered() || props.node.type === "element" && props.parentIsHovered;
          }
        });
      }
    }), null);
    return _el$;
  })();
}