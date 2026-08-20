import { template as _$template } from "solid-js/web";
import { setAttribute as _$setAttribute } from "solid-js/web";
import { effect as _$effect } from "solid-js/web";
import { insert as _$insert } from "solid-js/web";
import { memo as _$memo } from "solid-js/web";
import { createComponent as _$createComponent } from "solid-js/web";
var _tmpl$ = /*#__PURE__*/_$template(`<div><div class=mt-4><div class="text-sm flex flex-col bg-green-50 text-green-800 p-4 -mx-4 rounded whitespace-pre-wrap break-all"><label for=email class="block text-xs text-green-700">Link preview:`),
  _tmpl$2 = /*#__PURE__*/_$template(`<a class=hover:underline>`);
import { buildLink } from "../functions/buildLink";
import { EditorLinkForm } from "./EditorLinkForm";
import { ProjectLinkForm } from "./ProjectLinkForm";
import { useOptions } from "../functions/optionsStore";
import { TransformLinkForm } from "./TransformLinkForm";
import { HREF_TARGET } from "../consts";
import { LinkHrefTarget } from "./LinkHrefTarget";
export function LinkOptions(props) {
  const options = useOptions();
  function selectedTarget() {
    return options.getOptions().templateOrTemplateId;
  }
  function selectTarget(val) {
    options.setOptions({
      templateOrTemplateId: val
    });
  }
  const currentLink = () => props.linkProps ? buildLink(props.linkProps, props.targets, options, selectedTarget()) : undefined;
  return (() => {
    var _el$ = _tmpl$(),
      _el$2 = _el$.firstChild,
      _el$3 = _el$2.firstChild,
      _el$4 = _el$3.firstChild;
    _$insert(_el$, _$createComponent(ProjectLinkForm, {
      get value() {
        return options.getOptions().projectPath;
      },
      onChange: function (newValue) {
        options.setOptions({
          projectPath: newValue
        });
      }
    }), _el$2);
    _$insert(_el$, _$createComponent(TransformLinkForm, {
      get value() {
        return options.getOptions().replacePath;
      },
      onChange: newValue => {
        options.setOptions({
          replacePath: newValue
        });
      }
    }), _el$2);
    _$insert(_el$, _$createComponent(EditorLinkForm, {
      get targets() {
        return props.targets;
      },
      get selectedTarget() {
        return selectedTarget();
      },
      selectTarget: selectTarget
    }), _el$2);
    _$insert(_el$, _$createComponent(LinkHrefTarget, {
      get value() {
        return options.getOptions().hrefTarget;
      },
      onChange: newValue => {
        options.setOptions({
          hrefTarget: newValue
        });
      }
    }), _el$2);
    _$insert(_el$3, (() => {
      var _c$ = _$memo(() => !!currentLink());
      return () => _c$() ? (() => {
        var _el$5 = _tmpl$2();
        _$insert(_el$5, currentLink);
        _$effect(_p$ => {
          var _v$ = currentLink(),
            _v$2 = options.getOptions().hrefTarget || HREF_TARGET;
          _v$ !== _p$.e && _$setAttribute(_el$5, "href", _p$.e = _v$);
          _v$2 !== _p$.t && _$setAttribute(_el$5, "target", _p$.t = _v$2);
          return _p$;
        }, {
          e: undefined,
          t: undefined
        });
        return _el$5;
      })() : "To test the link, try to hover over some element.";
    })(), null);
    return _el$;
  })();
}