import { template as _$template } from "solid-js/web";
import { delegateEvents as _$delegateEvents } from "solid-js/web";
import { className as _$className } from "solid-js/web";
import { setAttribute as _$setAttribute } from "solid-js/web";
import { effect as _$effect } from "solid-js/web";
import { createComponent as _$createComponent } from "solid-js/web";
import { insert as _$insert } from "solid-js/web";
import { memo as _$memo } from "solid-js/web";
var _tmpl$ = /*#__PURE__*/_$template(`<div class="mt-2 border border-gray-200 rounded p-4 flex flex-col gap-1"><div class="flex justify-between self-stretch text-sm"><div>Editor / Link template</div><a class="underline cursor-pointer"></a></div><div class="text-xs text-gray-700">Change your editor for this project. For less common editors, you can change the link template.`),
  _tmpl$2 = /*#__PURE__*/_$template(`<div class="flex flex-col gap-1 py-1"><div class="flex items-center"><input id=custom type=radio class="focus:ring-indigo-200 h-4 w-4 text-indigo-600 border-slate-300 hover:border-slate-400"><label for=custom class="ml-2 block text-sm font-medium text-slate-700 hover:text-slate-800">Custom`),
  _tmpl$3 = /*#__PURE__*/_$template(`<div class="flex items-center"><input type=radio class="focus:ring-indigo-200 h-4 w-4 text-indigo-600 border-slate-300 hover:border-slate-400"><label class="ml-2 block text-sm font-medium text-slate-700 hover:text-slate-800">`),
  _tmpl$4 = /*#__PURE__*/_$template(`<div class=mt-1><input type=text name=text>`);
import { For } from "solid-js";
export function EditorLinkForm(props) {
  const defaultTarget = () => Object.entries(props.targets)[0][0];
  const selectedTarget = () => props.selectedTarget || "";
  function selectCustom() {
    props.selectTarget((props.targets[selectedTarget()] ? props.targets[selectedTarget()]?.url : selectedTarget()) || "");
  }
  const isCustom = () => !props.targets[selectedTarget()];
  return (() => {
    var _el$ = _tmpl$(),
      _el$2 = _el$.firstChild,
      _el$3 = _el$2.firstChild,
      _el$4 = _el$3.nextSibling,
      _el$5 = _el$2.nextSibling;
    _el$4.$$click = () => {
      if (props.selectedTarget === undefined) {
        props.selectTarget(defaultTarget());
      } else {
        props.selectTarget(undefined);
      }
    };
    _$insert(_el$4, () => props.selectedTarget === undefined ? "edit" : "clear");
    _$insert(_el$, (() => {
      var _c$ = _$memo(() => props.selectedTarget !== undefined);
      return () => _c$() ? [(() => {
        var _el$6 = _tmpl$2(),
          _el$7 = _el$6.firstChild,
          _el$8 = _el$7.firstChild;
        _$insert(_el$6, _$createComponent(For, {
          get each() {
            return Object.entries(props.targets);
          },
          children: ([key, target]) => (() => {
            var _el$9 = _tmpl$3(),
              _el$0 = _el$9.firstChild,
              _el$1 = _el$0.nextSibling;
            _el$0.$$click = () => {
              props.selectTarget(key);
            };
            _$setAttribute(_el$0, "id", key);
            _$setAttribute(_el$1, "for", key);
            _$insert(_el$1, () => target.label);
            _$effect(() => _el$0.checked = key === selectedTarget());
            return _el$9;
          })()
        }), _el$7);
        _el$8.$$click = () => {
          selectCustom();
        };
        _$effect(() => _el$8.checked = isCustom());
        return _el$6;
      })(), _$memo(() => _$memo(() => !!isCustom())() && (() => {
        var _el$10 = _tmpl$4(),
          _el$11 = _el$10.firstChild;
        _el$11.$$input = e => {
          props.selectTarget(e.currentTarget.value);
        };
        _el$11.$$click = () => {
          if (props.targets[selectedTarget()]) {
            selectCustom();
          }
        };
        _$effect(() => _$className(_el$11, "shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-slate-300 rounded-md " + (props.targets[selectedTarget()] ? "text-slate-400" : "text-slate-800")));
        _$effect(() => _el$11.value = props.targets[selectedTarget()] ? props.targets[selectedTarget()]?.url : selectedTarget());
        return _el$10;
      })())] : null;
    })(), null);
    return _el$;
  })();
}

// function ExpandableOption(props: {
//   label: string;

// }) {
//   return <div class="">

//   </div>
// }
_$delegateEvents(["click", "input"]);