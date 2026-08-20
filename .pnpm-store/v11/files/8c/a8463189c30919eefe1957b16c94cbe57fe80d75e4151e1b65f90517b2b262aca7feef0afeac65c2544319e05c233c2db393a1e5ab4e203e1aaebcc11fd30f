import { template as _$template } from "solid-js/web";
import { style as _$style } from "solid-js/web";
import { effect as _$effect } from "solid-js/web";
import { insert as _$insert } from "solid-js/web";
import { createComponent as _$createComponent } from "solid-js/web";
import { setStyleProperty as _$setStyleProperty } from "solid-js/web";
import { use as _$use } from "solid-js/web";
import { memo as _$memo } from "solid-js/web";
var _tmpl$ = /*#__PURE__*/_$template(`<svg xmlns=http://www.w3.org/2000/svg viewBox="0 0 24 24"style=pointer-events:none><title>sitemap</title><path fill=currentColor d="M9,2V8H11V11H5C3.89,11 3,11.89 3,13V16H1V22H7V16H5V13H11V16H9V22H15V16H13V13H19V16H17V22H23V16H21V13C21,11.89 20.11,11 19,11H13V8H15V2H9Z">`),
  _tmpl$2 = /*#__PURE__*/_$template(`<div><div class="fixed flex text-xs font-bold items-center justify-center text-sky-500 rounded border border-solid border-sky-500"style="z-index:2;text-shadow:-1px 1px 0 #fff, 1px 1px 0 #fff, 1px -1px 0 #fff, -1px -1px 0 #fff;text-overflow:ellipsis"><div class="absolute bg-black/60 text-white font-bold rounded-md px-1 py-1 flex"style=text-shadow:none;pointer-events:auto>`),
  _tmpl$3 = /*#__PURE__*/_$template(`<svg xmlns=http://www.w3.org/2000/svg viewBox="0 0 24 24"style=pointer-events:none><title>format-list-text</title><path fill=currentColor d="M2 14H8V20H2M16 8H10V10H16M2 10H8V4H2M10 4V6H22V4M10 20H16V18H10M10 16H22V14H10">`);
import { getParentsPaths } from "../adapters/getParentsPath";
import { Button } from "./Button";
import { ClipboardButton } from "./ClipboardButton";
import { ComponentOutline } from "./ComponentOutline";
import { RenderBoxes } from "./RenderBoxes";
import Tooltip from "./Tooltip";
export function Outline(props) {
  const box = () => props.element.thisElement.box;
  const domElementInfo = () => {
    const htmlElement = props.element.htmlElement;
    const box = props.element.thisElement.box;
    if (htmlElement && box) {
      const style = window.getComputedStyle(htmlElement);
      const margin = {
        top: parseFloat(style.marginTop),
        left: parseFloat(style.marginLeft),
        right: parseFloat(style.marginRight),
        bottom: parseFloat(style.marginBottom)
      };
      const padding = {
        top: parseFloat(style.paddingTop),
        left: parseFloat(style.paddingLeft),
        right: parseFloat(style.paddingRight),
        bottom: parseFloat(style.paddingBottom)
      };
      const individualMarginBoxes = {
        top: {
          top: box.y - margin.top,
          left: box.x,
          width: box.width,
          height: margin.top,
          label: label(margin.top)
        },
        left: {
          top: box.y - margin.top,
          left: box.x - margin.left,
          width: margin.left,
          height: box.height + margin.top + margin.bottom,
          label: label(margin.left)
        },
        right: {
          top: box.y - margin.top,
          left: box.x + box.width,
          width: margin.right,
          height: box.height + margin.top + margin.bottom,
          label: label(margin.right)
        },
        bottom: {
          top: box.y + box.height,
          left: box.x,
          width: box.width,
          height: margin.bottom,
          label: label(margin.bottom)
        }
      };
      const individualPaddingBoxes = {
        top: {
          top: box.y,
          left: box.x,
          width: box.width,
          height: padding.top,
          label: label(padding.top)
        },
        left: {
          top: box.y + padding.top,
          left: box.x,
          width: padding.left,
          height: box.height - padding.top - padding.bottom,
          label: label(padding.left)
        },
        right: {
          top: box.y + padding.top,
          left: box.x + box.width - padding.right,
          width: padding.right,
          height: box.height - padding.top - padding.bottom,
          label: label(padding.right)
        },
        bottom: {
          top: box.y + box.height - padding.bottom,
          left: box.x,
          width: box.width,
          height: padding.bottom,
          label: label(padding.bottom)
        }
      };
      return {
        margin: individualMarginBoxes,
        padding: individualPaddingBoxes,
        innerBox: {
          top: box.y + padding.top,
          left: box.x + padding.left,
          width: box.width - padding.left - padding.right,
          height: box.height - padding.top - padding.bottom,
          label: ""
        }
      };
    }
    return null;
  };
  let buttonsWrapper;
  function getOffset() {
    const buttonsWrapperWidth = buttonsWrapper?.clientWidth || 80;
    const offset = {
      top: -16,
      left: 0
    };
    if (box().width < buttonsWrapperWidth) {
      offset.left = -buttonsWrapperWidth / 2 + box().width / 2 - 1;
    }
    if (box().height < 40) {
      offset.top = -30;
    }
    return {
      top: offset.top + "px",
      left: offset.left + "px"
    };
  }
  const parentsWithLinks = () => getParentsPaths(props.element.htmlElement).filter(parent => parent.link);
  return [(() => {
    var _el$ = _tmpl$2(),
      _el$2 = _el$.firstChild,
      _el$3 = _el$2.firstChild;
    _$insert(_el$, (() => {
      var _c$ = _$memo(() => !!domElementInfo());
      return () => _c$() && _$createComponent(RenderBoxes, {
        get allBoxes() {
          return domElementInfo();
        }
      });
    })(), _el$2);
    var _ref$ = buttonsWrapper;
    typeof _ref$ === "function" ? _$use(_ref$, _el$3) : buttonsWrapper = _el$3;
    _$insert(_el$3, _$createComponent(Tooltip, {
      tooltipText: "Tree view",
      get children() {
        return _$createComponent(Button, {
          onClick: () => {
            props.showTreeFromElement(props.element.htmlElement);
          },
          get children() {
            var _el$4 = _tmpl$();
            _$setStyleProperty(_el$4, "width", "16px");
            _$setStyleProperty(_el$4, "height", "16px");
            return _el$4;
          }
        });
      }
    }), null);
    _$insert(_el$3, (() => {
      var _c$2 = _$memo(() => parentsWithLinks().length > 1);
      return () => _c$2() && _$createComponent(Tooltip, {
        tooltipText: "Parents",
        get children() {
          return _$createComponent(Button, {
            onClick: () => {
              props.showParentsPath(props.element.htmlElement, box().x + 2, box().y + 20);
            },
            get children() {
              var _el$5 = _tmpl$3();
              _$setStyleProperty(_el$5, "width", "16px");
              _$setStyleProperty(_el$5, "height", "16px");
              return _el$5;
            }
          });
        }
      });
    })(), null);
    _$insert(_el$3, _$createComponent(Tooltip, {
      tooltipText: "Copy path",
      get children() {
        return _$createComponent(ClipboardButton, {
          onClick: () => {
            props.copyToClipboard(props.element.htmlElement);
          }
        });
      }
    }), null);
    _$insert(_el$2, () => props.element.thisElement.label, null);
    _$effect(_p$ => {
      var _v$ = box().x + "px",
        _v$2 = box().y + "px",
        _v$3 = box().width + "px",
        _v$4 = box().height + "px",
        _v$5 = {
          ...getOffset()
        };
      _v$ !== _p$.e && _$setStyleProperty(_el$2, "left", _p$.e = _v$);
      _v$2 !== _p$.t && _$setStyleProperty(_el$2, "top", _p$.t = _v$2);
      _v$3 !== _p$.a && _$setStyleProperty(_el$2, "width", _p$.a = _v$3);
      _v$4 !== _p$.o && _$setStyleProperty(_el$2, "height", _p$.o = _v$4);
      _p$.i = _$style(_el$3, _v$5, _p$.i);
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined
    });
    return _el$;
  })(), _$memo(() => _$memo(() => props.element.componentsLabels.length > 0)() && _$createComponent(ComponentOutline, {
    get labels() {
      return props.element.componentsLabels;
    },
    get bbox() {
      return props.element.componentBox;
    },
    get element() {
      return props.element.htmlElement;
    },
    get showTreeFromElement() {
      return props.showTreeFromElement;
    },
    get targets() {
      return props.targets;
    }
  }))];
}
function label(value) {
  return value ? `${value}px` : "";
}