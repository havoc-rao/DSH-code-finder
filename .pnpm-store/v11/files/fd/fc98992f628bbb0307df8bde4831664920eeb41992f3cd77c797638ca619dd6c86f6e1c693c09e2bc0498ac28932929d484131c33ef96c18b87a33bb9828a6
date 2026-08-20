import { template as _$template } from "solid-js/web";
import { delegateEvents as _$delegateEvents } from "solid-js/web";
import { className as _$className } from "solid-js/web";
import { effect as _$effect } from "solid-js/web";
import { insert as _$insert } from "solid-js/web";
import { createComponent as _$createComponent } from "solid-js/web";
import { memo as _$memo } from "solid-js/web";
var _tmpl$ = /*#__PURE__*/_$template(`<div><div class="mt-2 text-xs text-gray-600">Support me on <a class="underline hover:text-sky-900 text-sky-700"href=https://github.com/sponsors/infi-pc target=_blank>GitHub sponsors`),
  _tmpl$2 = /*#__PURE__*/_$template(`<div class="fixed top-0 left-0 w-screen h-screen flex items-center justify-center bg-black/70 pointer-events-auto">`);
import { detectSvelte } from "@locator/shared";
import { batch, createEffect, createSignal, onCleanup, Show } from "solid-js";
import { render } from "solid-js/web";
import { isCombinationModifiersPressed } from "../functions/isCombinationModifiersPressed";
import { trackClickStats } from "../functions/trackClickStats";
import { MaybeOutline } from "./MaybeOutline";
import { SimpleNodeOutline } from "./SimpleNodeOutline";
import { IntroInfo } from "./IntroInfo";
import { Options } from "./Options";
import { bannerClasses } from "../functions/bannerClasses";
import BannerHeader from "./BannerHeader";
import { isExtension } from "../functions/isExtension";
import { NoLinkDialog } from "./NoLinkDialog";
import { WelcomeScreen } from "./WelcomeScreen";
import { isLocatorsOwnElement } from "../functions/isLocatorsOwnElement";
import { goToLinkProps } from "../functions/goTo";
import { getElementInfo } from "../adapters/getElementInfo";
import { getTree } from "../adapters/getTree";
import { TreeView } from "./TreeView";
import { OptionsProvider, useOptions } from "../functions/optionsStore";
import { DisableConfirmation } from "./DisableConfirmation";
import { ContextView } from "./ContextView";
function Runtime(props) {
  const [uiMode, setUiMode] = createSignal(["off"]);
  const [holdingModKey, setHoldingModKey] = createSignal(false);
  const [currentElement, setCurrentElement] = createSignal(null);
  const [dialog, setDialog] = createSignal(null);
  const [highlightedNode, setHighlightedNode] = createSignal(null);
  const options = useOptions();
  createEffect(() => {
    if (holdingModKey() && currentElement()) {
      document.body.classList.add("locatorjs-active-pointer");
    } else {
      document.body.classList.remove("locatorjs-active-pointer");
    }
  });
  function keyUpListener(e) {
    // if (e.code === "KeyO" && isCombinationModifiersPressed(e)) {
    //   if (uiMode()[0] === "tree") {
    //     setUiMode(["off"]);
    //   } else {
    //     setUiMode(["tree"]);
    //   }
    // }

    setHoldingModKey(isCombinationModifiersPressed(e));
  }
  function keyDownListener(e) {
    setHoldingModKey(isCombinationModifiersPressed(e, true));
  }
  function mouseOverListener(e) {
    const target = e.target;
    if (target && target instanceof HTMLElement) {
      // Ignore LocatorJS elements
      if (isLocatorsOwnElement(target)) {
        return;
      }
      setHoldingModKey(isCombinationModifiersPressed(e, true));
      batch(() => {
        setCurrentElement(target);
        // TODO: this is for highlighting elements in the tree, but need to move it to the adapter
        // if (solidMode()[0] === "tree" || solidMode()[0] === "treeFromElement") {
        //   const fiber = findFiberByHtmlElement(target, false);
        //   if (fiber) {
        //     const id = fiberToSimple(fiber, []);
        //     setHighlightedNode(id);
        //   }
        // }
      });

      // const found =
      //   target.closest("[data-locatorjs-id]") ||
      //   searchDevtoolsRenderersForClosestTarget(target);
      // if (found && found instanceof HTMLElement) {
      //   setCurrentElement(found);
      // }
    }
  }
  function mouseDownUpListener(e) {
    if (isCombinationModifiersPressed(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
  function showContextMenu(target, x, y) {
    setUiMode(["context", {
      target,
      x,
      y
    }]);
  }
  function copyToClipboard(target) {
    const elInfo = getElementInfo(target, props.adapterId);
    if (elInfo) {
      const linkProps = elInfo.thisElement.link;
      if (linkProps) {
        navigator.clipboard.writeText(linkProps.filePath);
      }
    }
  }
  function rightClickListener(e) {
    if (!isCombinationModifiersPressed(e, true)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const x = e.clientX;
    const y = e.clientY;

    // show context menu
    const target = e.target;
    if (target && target instanceof HTMLElement) {
      showContextMenu(target, x, y);
    }
  }
  function clickListener(e) {
    if (!isCombinationModifiersPressed(e) && uiMode()[0] !== "options") {
      return;
    }
    const target = e.target;
    if (target && target instanceof HTMLElement) {
      if (target.shadowRoot) {
        return;
      }
      if (isLocatorsOwnElement(target)) {
        return;
      }
      const elInfo = getElementInfo(target, props.adapterId);
      if (elInfo) {
        const linkProps = elInfo.thisElement.link;
        if (linkProps) {
          e.preventDefault();
          e.stopPropagation();
          trackClickStats();
          if ((!isExtension() || detectSvelte()) && !options.getOptions().welcomeScreenDismissed) {
            setDialog(["choose-editor", linkProps]);
          } else {
            // const link = buidLink(linkProps, props.targets);
            goToLinkProps(linkProps, props.targets, options);
          }
        } else {
          console.error("[LocatorJS]: Could not find link: Element info: ", elInfo);
          setDialog(["no-link"]);
        }
      } else {
        console.error("[LocatorJS]: Could not find element info. Element: ", target);
        setDialog(["no-link"]);
      }
    }
  }
  function scrollListener() {
    setCurrentElement(null);
  }
  const roots = [document];
  document.querySelectorAll("*").forEach(node => {
    if (node.id === "locatorjs-wrapper") {
      return;
    }
    if (node.shadowRoot) {
      roots.push(node.shadowRoot);
    }
  });
  for (const root of roots) {
    root.addEventListener("mouseover", mouseOverListener, {
      capture: true
    });
    root.addEventListener("keydown", keyDownListener);
    root.addEventListener("keyup", keyUpListener);
    root.addEventListener("click", clickListener, {
      capture: true
    });
    root.addEventListener("contextmenu", rightClickListener, {
      capture: true
    });
    root.addEventListener("mousedown", mouseDownUpListener, {
      capture: true
    });
    root.addEventListener("mouseup", mouseDownUpListener, {
      capture: true
    });
    root.addEventListener("scroll", scrollListener);
  }
  onCleanup(() => {
    for (const root of roots) {
      root.removeEventListener("keyup", keyUpListener);
      root.removeEventListener("keydown", keyDownListener);
      root.removeEventListener("mouseover", mouseOverListener, {
        capture: true
      });
      root.removeEventListener("click", clickListener, {
        capture: true
      });
      root.removeEventListener("contextmenu", rightClickListener, {
        capture: true
      });
      root.removeEventListener("mousedown", mouseDownUpListener, {
        capture: true
      });
      root.removeEventListener("mouseup", mouseDownUpListener, {
        capture: true
      });
      root.removeEventListener("scroll", scrollListener);
    }
  });
  function showTreeFromElement(element) {
    const newState = getTree(element);
    if (newState) {
      setUiMode(["tree", newState]);
    }
  }
  function openOptions() {
    setUiMode(["options"]);
  }
  return [_$memo(() => _$memo(() => uiMode()[0] === "tree")() ? _$createComponent(TreeView, {
    get treeState() {
      return uiMode()[1];
    },
    close: () => setUiMode(["off"]),
    setTreeState: newState => setUiMode(["tree", newState]),
    get adapterId() {
      return props.adapterId;
    },
    get targets() {
      return props.targets;
    },
    setHighlightedNode: setHighlightedNode
  }) : null), _$memo(() => _$memo(() => uiMode()[0] === "context")() ? _$createComponent(ContextView, {
    get contextMenuState() {
      return uiMode()[1];
    },
    close: () => setUiMode(["off"]),
    get adapterId() {
      return props.adapterId;
    },
    get targets() {
      return props.targets;
    },
    setHighlightedNode: setHighlightedNode
  }) : null), _$memo(() => _$memo(() => !!((holdingModKey() || uiMode()[0] === "options") && currentElement()))() ? _$createComponent(MaybeOutline, {
    get currentElement() {
      return currentElement();
    },
    get adapterId() {
      return props.adapterId;
    },
    get targets() {
      return props.targets;
    },
    showTreeFromElement: showTreeFromElement,
    showParentsPath: showContextMenu,
    copyToClipboard: copyToClipboard
  }) : null), _$memo(() => _$memo(() => !!holdingModKey())() ? (() => {
    var _el$ = _tmpl$(),
      _el$2 = _el$.firstChild,
      _el$3 = _el$2.firstChild,
      _el$5 = _el$3.nextSibling;
    _$insert(_el$, _$createComponent(BannerHeader, {
      openOptions: openOptions,
      get adapter() {
        return props.adapterId;
      }
    }), _el$2);
    _el$5.$$click = e => {
      e.preventDefault();
      e.stopPropagation();
      window.open(`https://github.com/sponsors/infi-pc`);
    };
    _$effect(() => _$className(_el$, bannerClasses()));
    return _el$;
  })() : null), _$memo(() => _$memo(() => !!highlightedNode())() ? _$createComponent(SimpleNodeOutline, {
    get node() {
      return highlightedNode();
    }
  }) : null), _$memo(() => _$memo(() => !!(props.showIntro !== false && !isExtension() && options.getOptions().showIntro !== false))() ? _$createComponent(IntroInfo, {
    openOptions: openOptions,
    get hide() {
      return !!holdingModKey() || uiMode()[0] !== "off";
    },
    get adapter() {
      return props.adapterId;
    }
  }) : null), _$memo(() => _$memo(() => uiMode()[0] === "options")() ? _$createComponent(Options, {
    get adapterId() {
      return props.adapterId;
    },
    get targets() {
      return props.targets;
    },
    onClose: () => {
      setUiMode(["off"]);
    },
    showDisableDialog: () => {
      setUiMode(["disable-confirmation"]);
    },
    get currentElement() {
      return currentElement();
    }
  }) : null), _$memo(() => _$memo(() => uiMode()[0] === "disable-confirmation")() ? _$createComponent(DisableConfirmation, {
    onClose: () => {
      setUiMode(["off"]);
    }
  }) : null), _$memo(() => _$memo(() => !!dialog())() && (() => {
    var _el$6 = _tmpl$2();
    _el$6.$$click = e => {
      if (e.currentTarget === e.target) {
        setDialog(null);
      }
    };
    _$insert(_el$6, (() => {
      var _c$ = _$memo(() => dialog()[0] === "no-link");
      return () => _c$() && _$createComponent(NoLinkDialog, {});
    })(), null);
    _$insert(_el$6, (() => {
      var _c$2 = _$memo(() => dialog()[0] === "choose-editor");
      return () => _c$2() && _$createComponent(WelcomeScreen, {
        get targets() {
          return props.targets;
        },
        get originalLinkProps() {
          return dialog()[1];
        },
        onClose: () => {
          setDialog(null);
        }
      });
    })(), null);
    return _el$6;
  })())];
}
function RuntimeWrapper(props) {
  const options = useOptions();
  const isDisabled = () => options.getOptions().disabled || false;
  createEffect(() => {
    if (isDisabled() && isExtension()) {
      document.head.dataset.locatorDisabled = "disabled";
    } else {
      delete document.head.dataset.locatorDisabled;
    }
  });
  return _$createComponent(Show, {
    get when() {
      return !isDisabled();
    },
    get children() {
      return _$createComponent(Runtime, props);
    }
  });
}
export function initRender(solidLayer, adapter, targets, showIntro) {
  render(() => _$createComponent(OptionsProvider, {
    get children() {
      return _$createComponent(RuntimeWrapper, {
        get targets() {
          return Object.fromEntries(Object.entries(targets).map(([key, t]) => {
            return [key, typeof t == "string" ? {
              url: t,
              label: key
            } : t];
          }));
        },
        adapterId: adapter,
        showIntro: showIntro
      });
    }
  }), solidLayer);
}
_$delegateEvents(["click"]);