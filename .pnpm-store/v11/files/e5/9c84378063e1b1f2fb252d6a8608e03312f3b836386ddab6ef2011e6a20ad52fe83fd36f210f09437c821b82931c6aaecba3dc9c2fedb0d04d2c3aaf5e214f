import { template as _$template } from "solid-js/web";
import { delegateEvents as _$delegateEvents } from "solid-js/web";
import { effect as _$effect } from "solid-js/web";
import { memo as _$memo } from "solid-js/web";
import { insert as _$insert } from "solid-js/web";
import { addEventListener as _$addEventListener } from "solid-js/web";
import { setStyleProperty as _$setStyleProperty } from "solid-js/web";
import { createComponent as _$createComponent } from "solid-js/web";
var _tmpl$ = /*#__PURE__*/_$template(`<div class=locatorjs-tree-node style=padding-left:1em;font-size:14px;font-family:monospace;min-width:300px;pointer-events:auto><button style=pointer-events:auto>&lt;<!>>`),
  _tmpl$2 = /*#__PURE__*/_$template(`<div style=min-width:300px><div style="font-size:12px;justify-content:space-between;font-family:Helvitica, sans-serif"><div style=font-weight:bold>:</div> <div>`),
  _tmpl$3 = /*#__PURE__*/_$template(`<button>...`);
import { createSignal, For } from "solid-js";
import { goToSource } from "../functions/goTo";
import { useOptions } from "../functions/optionsStore";
export function TreeNode(props) {
  const options = useOptions();
  const [manuallyExpanded, setManuallyExpanded] = createSignal(false);
  function isExpanded() {
    return manuallyExpanded() || props.idsThatHaveExpandedSuccessor[props.node.uniqueId];
  }
  function renderChildren() {
    return _$createComponent(For, {
      get each() {
        return props.node.children;
      },
      children: child => _$createComponent(TreeNode, {
        node: child,
        get idsToShow() {
          return props.idsToShow;
        },
        get idsThatHaveExpandedSuccessor() {
          return props.idsThatHaveExpandedSuccessor;
        },
        get highlightedNode() {
          return props.highlightedNode;
        },
        get targets() {
          return props.targets;
        }
      })
    });
  }
  const isHighlighted = () => props.highlightedNode.getNode()?.uniqueId === props.node.uniqueId;
  return (() => {
    var _el$ = _tmpl$(),
      _el$2 = _el$.firstChild,
      _el$3 = _el$2.firstChild,
      _el$5 = _el$3.nextSibling,
      _el$4 = _el$5.nextSibling;
    _$setStyleProperty(_el$, "cursor", "pointer");
    _$addEventListener(_el$2, "mouseover", e => {
      e.stopPropagation();
      props.highlightedNode.setNode(props.node);
    });
    _el$2.$$click = () => {
      if (props.node.source) {
        goToSource(props.node.source, props.targets, options);
      }
    };
    _$insert(_el$2, () => props.node.name, _el$5);
    _$insert(_el$, (() => {
      var _c$ = _$memo(() => !!isExpanded());
      return () => _c$() ? _$memo(() => _$memo(() => !!(props.node.type === "component" && props.node.source?.fileName))() ? (() => {
        var _el$6 = _tmpl$2(),
          _el$7 = _el$6.firstChild,
          _el$8 = _el$7.firstChild,
          _el$9 = _el$8.firstChild,
          _el$0 = _el$8.nextSibling,
          _el$1 = _el$0.nextSibling;
        _$addEventListener(_el$6, "mouseover", e => {
          e.stopPropagation();
          props.highlightedNode.setNode(props.node);
        });
        _$setStyleProperty(_el$6, "border", "1px solid #ccc");
        _$setStyleProperty(_el$6, "padding", "0.5em");
        _$setStyleProperty(_el$7, "display", "flex");
        _$insert(_el$8, () => props.node.name, _el$9);
        _$setStyleProperty(_el$1, "color", "#888");
        _$insert(_el$1, () => props.node.definitionSourceFile);
        _$insert(_el$6, renderChildren, null);
        _$effect(_$p => _$setStyleProperty(_el$6, "background", isHighlighted() ? "rgba(0,0,0,0.1)" : "transparent"));
        return _el$6;
      })() : renderChildren()) : _$memo(() => !!props.node.children.length)() ? (() => {
        var _el$10 = _tmpl$3();
        _el$10.$$click = () => {
          setManuallyExpanded(true);
        };
        return _el$10;
      })() : null;
    })(), null);
    _$effect(_p$ => {
      var _v$ = isHighlighted() ? "rgba(0,0,0,0.1)" : "white",
        _v$2 = props.idsToShow[props.node.uniqueId] ? "red" : "",
        _v$3 = props.idsThatHaveExpandedSuccessor[props.node.uniqueId] ? "1px solid red" : "1px solid black",
        _v$4 = props.node.source ? "underline" : "";
      _v$ !== _p$.e && _$setStyleProperty(_el$2, "background-color", _p$.e = _v$);
      _v$2 !== _p$.t && _$setStyleProperty(_el$2, "color", _p$.t = _v$2);
      _v$3 !== _p$.a && _$setStyleProperty(_el$2, "border", _p$.a = _v$3);
      _v$4 !== _p$.o && _$setStyleProperty(_el$2, "text-decoration", _p$.o = _v$4);
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined
    });
    return _el$;
  })();
}
_$delegateEvents(["click"]);