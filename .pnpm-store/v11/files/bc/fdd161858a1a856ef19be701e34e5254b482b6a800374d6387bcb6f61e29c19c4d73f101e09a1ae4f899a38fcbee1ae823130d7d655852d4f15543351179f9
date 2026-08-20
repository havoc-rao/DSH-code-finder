import { template as _$template } from "solid-js/web";
import { delegateEvents as _$delegateEvents } from "solid-js/web";
import { effect as _$effect } from "solid-js/web";
import { insert as _$insert } from "solid-js/web";
import { memo as _$memo } from "solid-js/web";
var _tmpl$ = /*#__PURE__*/_$template(`<div class="mt-2 border border-gray-200 rounded p-4 flex flex-col gap-1"><div class="flex justify-between self-stretch text-sm"><div>Project path (prefix)</div><a class="underline cursor-pointer"></a></div><div class="text-xs text-gray-700">If your framework generates relative paths, you can add a prefix to it to make absolute paths.`),
  _tmpl$2 = /*#__PURE__*/_$template(`<div class="py-2 flex flex-col gap-2"><input id=project-path placeholder="e.g. /Users/MyName/MyProject"type=text name=text class="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-slate-300 rounded-md"><div class="text-xs text-slate-700 pt-2">Run <code class="bg-slate-100 rounded py-1 px-2">pwd</code> or <code class="bg-slate-100 rounded py-1 px-2">echo %cd%</code> to get the current path`);
const exampleProjectPath = `/Users/MyName/MyProject`; //`C://my-projects/my-project`;

export function ProjectLinkForm(props) {
  return (() => {
    var _el$ = _tmpl$(),
      _el$2 = _el$.firstChild,
      _el$3 = _el$2.firstChild,
      _el$4 = _el$3.nextSibling,
      _el$5 = _el$2.nextSibling;
    _el$4.$$click = () => {
      if (props.value === undefined) {
        props.onChange("");
      } else {
        props.onChange(undefined);
      }
    };
    _$insert(_el$4, () => props.value === undefined ? "edit" : "clear");
    _$insert(_el$, (() => {
      var _c$ = _$memo(() => props.value !== undefined);
      return () => _c$() ? (() => {
        var _el$6 = _tmpl$2(),
          _el$7 = _el$6.firstChild;
        _el$7.$$input = e => {
          props.onChange(e.currentTarget.value);
        };
        _$effect(() => _el$7.value = props.value);
        return _el$6;
      })() : [];
    })(), null);
    return _el$;
  })();
}
_$delegateEvents(["click", "input"]);