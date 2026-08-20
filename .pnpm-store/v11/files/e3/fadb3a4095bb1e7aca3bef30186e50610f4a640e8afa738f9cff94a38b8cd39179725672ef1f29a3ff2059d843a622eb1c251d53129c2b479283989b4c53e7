import { template as _$template } from "solid-js/web";
import { delegateEvents as _$delegateEvents } from "solid-js/web";
import { setAttribute as _$setAttribute } from "solid-js/web";
import { style as _$style } from "solid-js/web";
import { effect as _$effect } from "solid-js/web";
import { insert as _$insert } from "solid-js/web";
import { createComponent as _$createComponent } from "solid-js/web";
import { setStyleProperty as _$setStyleProperty } from "solid-js/web";
var _tmpl$ = /*#__PURE__*/_$template(`<div class="border border-purple-500"style=z-index:1><div id=locatorjs-labels-section style=justify-content:center;pointer-events:auto><div id=locatorjs-labels-wrapper>`),
  _tmpl$2 = /*#__PURE__*/_$template(`<a class="cursor-pointer bg-purple-500 block text-white text-xs font-bold text-center px-1 py-0.5 rounded whitespace-nowrap pointer-events-auto hover:bg-purple-600">`),
  _tmpl$3 = /*#__PURE__*/_$template(`<div class="cursor-pointer bg-purple-500 block text-white text-xs font-bold text-center px-1 py-0.5 rounded whitespace-nowrap pointer-events-auto hover:bg-purple-600">`);
import { For } from "solid-js";
import { HREF_TARGET, PADDING } from "../consts";
import { trackClickStats } from "../functions/trackClickStats";
import { goTo } from "../functions/goTo";
import { buildLink } from "../functions/buildLink";
import { useOptions } from "../functions/optionsStore";
export function ComponentOutline(props) {
  const options = useOptions();
  const isInside = () => props.bbox.height >= window.innerHeight - 40;
  const isBelow = () => props.bbox.y < 30 && !isInside();
  const left = () => Math.max(props.bbox.x - PADDING, 0);
  const top = () => Math.max(props.bbox.y - PADDING, 0);
  const cutFromTop = () => props.bbox.y < 0 ? -(props.bbox.y - PADDING) : 0;
  const cutFromLeft = () => props.bbox.x < 0 ? -(props.bbox.x - PADDING) : 0;
  const width = () => Math.min(props.bbox.width - cutFromLeft() + PADDING * 2, window.innerWidth);
  const height = () => Math.min(props.bbox.height - cutFromTop() + PADDING * 2, window.innerHeight);
  return (() => {
    var _el$ = _tmpl$(),
      _el$2 = _el$.firstChild,
      _el$3 = _el$2.firstChild;
    _$setStyleProperty(_el$, "position", "fixed");
    _$insert(_el$3, _$createComponent(For, {
      get each() {
        return props.labels;
      },
      children: label => {
        const link = label.link ? buildLink(label.link, props.targets, options) : null;
        const labelClass = "cursor-pointer bg-purple-500 block text-white text-xs font-bold text-center px-1 py-0.5 rounded whitespace-nowrap pointer-events-auto hover:bg-purple-600";
        const labelStyles = {
          "line-height": "18px"
        };
        return link ? (() => {
          var _el$4 = _tmpl$2();
          _el$4.$$click = () => {
            trackClickStats();
            goTo(link, options);
          };
          _$setAttribute(_el$4, "href", link);
          _$insert(_el$4, () => label.label);
          _$effect(_p$ => {
            var _v$1 = labelStyles,
              _v$10 = options.getOptions().hrefTarget || HREF_TARGET;
            _p$.e = _$style(_el$4, _v$1, _p$.e);
            _v$10 !== _p$.t && _$setAttribute(_el$4, "target", _p$.t = _v$10);
            return _p$;
          }, {
            e: undefined,
            t: undefined
          });
          return _el$4;
        })() : (() => {
          var _el$5 = _tmpl$3();
          _$insert(_el$5, () => label.label);
          _$effect(_$p => _$style(_el$5, labelStyles, _$p));
          return _el$5;
        })();
      }
    }));
    _$effect(_p$ => {
      var _v$ = left() + "px",
        _v$2 = top() + "px",
        _v$3 = width() + "px",
        _v$4 = height() + "px",
        _v$5 = left() === 0 || top() === 0 ? "0" : "8px",
        _v$6 = left() + width() === window.innerWidth || top() === 0 ? "0" : "8px",
        _v$7 = left() === 0 || top() + height() === window.innerHeight ? "0" : "8px",
        _v$8 = left() + width() === window.innerWidth || top() + height() === window.innerHeight ? "0" : "8px",
        _v$9 = {
          position: "absolute",
          display: "flex",
          bottom: isBelow() ? isInside() ? "2px" : "-28px" : undefined,
          top: isBelow() ? undefined : isInside() ? "2px" : "-28px",
          left: "0px",
          width: "100%",
          cursor: "pointer",
          ...(isBelow() ? {
            "border-bottom-left-radius": "100%",
            "border-bottom-right-radius": "100%"
          } : {
            "border-top-left-radius": "100%",
            "border-top-right-radius": "100%"
          })
        },
        _v$0 = isBelow() ? "10px 10px 2px 10px" : "2px 10px 10px 10px";
      _v$ !== _p$.e && _$setStyleProperty(_el$, "left", _p$.e = _v$);
      _v$2 !== _p$.t && _$setStyleProperty(_el$, "top", _p$.t = _v$2);
      _v$3 !== _p$.a && _$setStyleProperty(_el$, "width", _p$.a = _v$3);
      _v$4 !== _p$.o && _$setStyleProperty(_el$, "height", _p$.o = _v$4);
      _v$5 !== _p$.i && _$setStyleProperty(_el$, "border-top-left-radius", _p$.i = _v$5);
      _v$6 !== _p$.n && _$setStyleProperty(_el$, "border-top-right-radius", _p$.n = _v$6);
      _v$7 !== _p$.s && _$setStyleProperty(_el$, "border-bottom-left-radius", _p$.s = _v$7);
      _v$8 !== _p$.h && _$setStyleProperty(_el$, "border-bottom-right-radius", _p$.h = _v$8);
      _p$.r = _$style(_el$2, _v$9, _p$.r);
      _v$0 !== _p$.d && _$setStyleProperty(_el$3, "padding", _p$.d = _v$0);
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined,
      n: undefined,
      s: undefined,
      h: undefined,
      r: undefined,
      d: undefined
    });
    return _el$;
  })();
}
_$delegateEvents(["click"]);