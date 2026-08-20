import { template as _$template } from "solid-js/web";
import { delegateEvents as _$delegateEvents } from "solid-js/web";
import { createComponent as _$createComponent } from "solid-js/web";
import { effect as _$effect } from "solid-js/web";
import { insert as _$insert } from "solid-js/web";
import { memo as _$memo } from "solid-js/web";
import { use as _$use } from "solid-js/web";
import { setStyleProperty as _$setStyleProperty } from "solid-js/web";
var _tmpl$ = /*#__PURE__*/_$template(`<div style=pointer-events:auto;background-color:rgba(0,0,0,0.1);z-index:1001><div><div class="m-2 bg-white rounded-md p-4 shadow-xl text-xs overflow-auto"style="max-height:calc(100vh - 16px)">`),
  _tmpl$2 = /*#__PURE__*/_$template(`<div>`),
  _tmpl$3 = /*#__PURE__*/_$template(`<div class=mb-2><button class="inline-flex cursor-pointer bg-gray-100 rounded-full hover:bg-gray-200 py-0 px-2 ">...`);
import { TreeNodeElementView } from "./TreeNodeElementView";
import { createEffect, createSignal } from "solid-js";
import { computePosition, flip, shift, offset } from "@floating-ui/dom";
export function TreeView(props) {
  let contentRef;
  const [pos, setPos] = createSignal();
  createEffect(() => {
    if (contentRef) {
      const originalBox = props.treeState.originalNode.getBox();
      computePosition({
        getBoundingClientRect: () => {
          return {
            top: originalBox?.y || 0,
            left: originalBox?.x || 0,
            width: 16,
            height: 16
          };
        }
      }, contentRef, {
        placement: "left-start",
        middleware: [offset(10), shift(), flip()]
      }).then(({
        x,
        y
      }) => {
        setPos({
          x,
          y
        });
      });
    }
  });
  return (() => {
    var _el$ = _tmpl$(),
      _el$2 = _el$.firstChild,
      _el$3 = _el$2.firstChild;
    _el$.$$click = e => {
      if (e.currentTarget === e.target) {
        props.close();
      }
    };
    _$setStyleProperty(_el$, "position", "fixed");
    _$setStyleProperty(_el$, "top", "0");
    _$setStyleProperty(_el$, "left", "0");
    _$setStyleProperty(_el$, "width", "100vw");
    _$setStyleProperty(_el$, "height", "100vh");
    var _ref$ = contentRef;
    typeof _ref$ === "function" ? _$use(_ref$, _el$2) : contentRef = _el$2;
    _$setStyleProperty(_el$2, "position", "absolute");
    _$insert(_el$3, (() => {
      var _c$ = _$memo(() => !!props.treeState);
      return () => _c$() ? (() => {
        var _el$4 = _tmpl$2();
        _$insert(_el$4, (() => {
          var _c$2 = _$memo(() => !!props.treeState?.root.getParent());
          return () => _c$2() ? (() => {
            var _el$5 = _tmpl$3(),
              _el$6 = _el$5.firstChild;
            _el$6.$$click = () => {
              const state = props.treeState;
              const parent = state.root.getParent();
              if (parent) {
                state.expandedIds.add(parent.uniqueId);
                props.setTreeState({
                  ...state,
                  root: parent
                });
              }
            };
            return _el$5;
          })() : null;
        })(), null);
        _$insert(_el$4, _$createComponent(TreeNodeElementView, {
          get node() {
            return props.treeState.root;
          },
          get expandedIds() {
            return props.treeState.expandedIds;
          },
          get highlightedId() {
            return props.treeState.highlightedId;
          },
          expandId: id => {
            const state = props.treeState;
            state.expandedIds.add(id);
            props.setTreeState(state);
          },
          get targets() {
            return props.targets;
          },
          get setHighlightedBoundingBox() {
            return props.setHighlightedNode;
          },
          parentComponent: null
        }), null);
        return _el$4;
      })() : "no tree";
    })());
    _$effect(_p$ => {
      var _v$ = `${pos()?.y || 0}px`,
        _v$2 = `${pos()?.x || 0}px`;
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
_$delegateEvents(["click"]);