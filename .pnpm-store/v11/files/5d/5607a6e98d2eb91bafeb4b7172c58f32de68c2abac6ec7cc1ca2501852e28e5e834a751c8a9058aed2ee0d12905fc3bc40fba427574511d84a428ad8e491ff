import { template as _$template } from "solid-js/web";
import { delegateEvents as _$delegateEvents } from "solid-js/web";
import { effect as _$effect } from "solid-js/web";
import { insert as _$insert } from "solid-js/web";
import { memo as _$memo } from "solid-js/web";
var _tmpl$ = /*#__PURE__*/_$template(`<div class="mt-2 border border-gray-200 rounded p-4 flex flex-col gap-1"><div class="flex justify-between self-stretch text-sm"><div>Transform final link</div><a class="underline cursor-pointer"></a></div><div class="text-xs text-gray-700">In case you need to change something in the final generated link you can find and replace parts with Regex`),
  _tmpl$2 = /*#__PURE__*/_$template(`<div class=py-2><div class="flex gap-2"><div class=grow><label for=project-path class="block text-sm text-slate-700 pb-0.5 font-bold">From (Regex)</label><input id=project-path placeholder="from regex"type=text name=text class="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-slate-300 rounded-md"></div><div class=grow><label for=project-path class="block text-sm text-slate-700 pb-0.5 font-bold">To</label><input id=project-path placeholder=to type=text name=text class="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-slate-300 rounded-md">`),
  _tmpl$3 = /*#__PURE__*/_$template(`<div class="text-red-600 mt-1 text-sm">Regex is not valid!`);
const defaultValue = {
  from: "",
  to: ""
};
export function TransformLinkForm(props) {
  const isInvalid = () => {
    if (!props.value || !props.value.from) {
      return false;
    }
    try {
      new RegExp(`${props.value.from}`);
    } catch (x) {
      return true;
    }
    return false;
  };
  return (() => {
    var _el$ = _tmpl$(),
      _el$2 = _el$.firstChild,
      _el$3 = _el$2.firstChild,
      _el$4 = _el$3.nextSibling,
      _el$5 = _el$2.nextSibling;
    _el$4.$$click = () => {
      if (props.value === undefined) {
        props.onChange(defaultValue);
      } else {
        props.onChange(undefined);
      }
    };
    _$insert(_el$4, () => props.value === undefined ? "edit" : "clear");
    _$insert(_el$, (() => {
      var _c$ = _$memo(() => props.value !== undefined);
      return () => _c$() ? (() => {
        var _el$6 = _tmpl$2(),
          _el$7 = _el$6.firstChild,
          _el$8 = _el$7.firstChild,
          _el$9 = _el$8.firstChild,
          _el$0 = _el$9.nextSibling,
          _el$1 = _el$8.nextSibling,
          _el$10 = _el$1.firstChild,
          _el$11 = _el$10.nextSibling;
        _el$0.$$input = e => {
          props.onChange({
            ...(props.value || defaultValue),
            from: e.currentTarget.value
          });
        };
        _el$11.$$input = e => {
          props.onChange({
            ...(props.value || defaultValue),
            to: e.currentTarget.value
          });
        };
        _$insert(_el$6, (() => {
          var _c$2 = _$memo(() => !!isInvalid());
          return () => _c$2() ? _tmpl$3() : null;
        })(), null);
        _$effect(() => _el$0.value = props.value.from);
        _$effect(() => _el$11.value = props.value.to);
        return _el$6;
      })() : null;
    })(), null);
    return _el$;
  })();
}
_$delegateEvents(["click", "input"]);