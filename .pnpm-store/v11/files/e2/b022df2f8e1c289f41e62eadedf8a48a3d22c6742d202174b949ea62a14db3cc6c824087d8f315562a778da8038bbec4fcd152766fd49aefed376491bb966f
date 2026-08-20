import { template as _$template } from "solid-js/web";
import { delegateEvents as _$delegateEvents } from "solid-js/web";
import { setAttribute as _$setAttribute } from "solid-js/web";
import { className as _$className } from "solid-js/web";
import { effect as _$effect } from "solid-js/web";
import { insert as _$insert } from "solid-js/web";
import { createComponent as _$createComponent } from "solid-js/web";
import { setStyleProperty as _$setStyleProperty } from "solid-js/web";
import { use as _$use } from "solid-js/web";
var _tmpl$ = /*#__PURE__*/_$template(`<div tabindex=0 style=pointer-events:auto;background-color:rgba(0,0,0,0.1);z-index:1001><div><div class="bg-white rounded-md py-2 shadow-xl text-xs overflow-auto flex flex-col"style="max-height:calc(100vh - 16px)">`),
  _tmpl$2 = /*#__PURE__*/_$template(`<a><div class="text-xs text-gray-500">`);
import { createSignal, For, onMount } from "solid-js";
import { getParentsPaths } from "../adapters/getParentsPath";
import { buildLink } from "../functions/buildLink";
import getUsableFileName from "../functions/getUsableFileName";
import { goToLinkProps } from "../functions/goTo";
import { useOptions } from "../functions/optionsStore";
export function ContextView(props) {
  const options = useOptions();
  let contentRef;
  let list;
  let root;
  onMount(() => {
    if (root) {
      root.focus();
    }
  });
  const [focusedIndex, setFocusedIndex] = createSignal(null);
  const paths = () => getParentsPaths(props.contextMenuState.target, props.adapterId);
  function focusOnElementInDirection(direction) {
    if (focusedIndex == null) {
      setFocusedIndex(0);
      return;
    }
    let newFocused = focusedIndex() ?? -1;
    if (direction === "down") {
      newFocused += 1;
    }
    if (direction === "up") {
      newFocused -= 1;
    }
    if (newFocused < 0) {
      newFocused = paths().length - 1;
    }
    if (newFocused > paths().length - 1) {
      newFocused = 0;
    }
    setFocusedIndex(newFocused);
    window.setTimeout(() => {
      scrollActiveOptionIntoView();
    }, 0);
  }
  function scrollActiveOptionIntoView() {
    if (focusedIndex == null) {
      return;
    }
    list?.querySelector(`:nth-child(${(focusedIndex() || 0) + 1})`)?.scrollIntoView({
      block: "nearest"
    });
  }
  function handleKeyDown(e) {
    switch (e.key) {
      case "Escape":
        {
          e.preventDefault();
          e.stopPropagation();
          props.close();
          break;
        }
      case "ArrowDown":
        {
          e.preventDefault();
          focusOnElementInDirection("down");
          break;
        }
      case "ArrowUp":
        {
          e.preventDefault();
          focusOnElementInDirection("up");
          break;
        }
      case "Enter":
      case " ":
        {
          e.preventDefault();
          if (focusedIndex() !== null) {
            const path = paths()[focusedIndex()];
            if (path) {
              goToLinkProps(path.link, props.targets, options);
            }
            setFocusedIndex(null);
          }
          props.close();
          break;
        }
    }
  }
  return (() => {
    var _el$ = _tmpl$(),
      _el$2 = _el$.firstChild,
      _el$3 = _el$2.firstChild;
    _el$.$$keydown = handleKeyDown;
    _el$.$$click = e => {
      if (e.currentTarget === e.target) {
        props.close();
      }
    };
    var _ref$ = root;
    typeof _ref$ === "function" ? _$use(_ref$, _el$) : root = _el$;
    _$setStyleProperty(_el$, "position", "fixed");
    _$setStyleProperty(_el$, "top", "0");
    _$setStyleProperty(_el$, "left", "0");
    _$setStyleProperty(_el$, "width", "100vw");
    _$setStyleProperty(_el$, "height", "100vh");
    var _ref$2 = contentRef;
    typeof _ref$2 === "function" ? _$use(_ref$2, _el$2) : contentRef = _el$2;
    _$setStyleProperty(_el$2, "position", "absolute");
    var _ref$3 = list;
    typeof _ref$3 === "function" ? _$use(_ref$3, _el$3) : list = _el$3;
    _$insert(_el$3, _$createComponent(For, {
      get each() {
        return paths();
      },
      children: (path, index) => {
        const link = path.link;
        if (!link) {
          return null;
        }
        return (() => {
          var _el$4 = _tmpl$2(),
            _el$5 = _el$4.firstChild;
          _el$4.$$click = e => {
            e.preventDefault();
            e.stopPropagation();
            goToLinkProps(link, props.targets, options);
            props.close();
          };
          _$insert(_el$4, () => path.title, _el$5);
          _$insert(_el$5, () => getUsableFileName(link.filePath || ""));
          _$effect(_p$ => {
            var _v$3 = "px-4 py-2 w-60 hover:bg-slate-50 text-left text-sm font-medium " + (index() === focusedIndex() ? "bg-slate-100" : ""),
              _v$4 = buildLink(link, props.targets, options);
            _v$3 !== _p$.e && _$className(_el$4, _p$.e = _v$3);
            _v$4 !== _p$.t && _$setAttribute(_el$4, "href", _p$.t = _v$4);
            return _p$;
          }, {
            e: undefined,
            t: undefined
          });
          return _el$4;
        })();
      }
    }));
    _$effect(_p$ => {
      var _v$ = `${props.contextMenuState.y || 0}px`,
        _v$2 = `${props.contextMenuState.x || 0}px`;
      _v$ !== _p$.e && _$setStyleProperty(_el$2, "top", _p$.e = _v$);
      _v$2 !== _p$.t && _$setStyleProperty(_el$2, "left", _p$.t = _v$2);
      return _p$;
    }, {
      e: undefined,
      t: undefined
    });
    return _el$;
  })();
}
_$delegateEvents(["click", "keydown"]);