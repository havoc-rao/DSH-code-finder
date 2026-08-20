export function getMouseModifiers() {
  const mouseModifiers = document.documentElement.dataset.locatorMouseModifiers || "alt";
  const mouseModifiersArray = mouseModifiers.split("+");
  const modifiers = {};
  mouseModifiersArray.forEach(modifier => {
    modifiers[modifier] = true;
  }, {});
  return modifiers;
}
export function isCombinationModifiersPressed(e, rightClick = false) {
  const modifiers = getMouseModifiers();
  if (rightClick) {
    return e.altKey == !!modifiers.alt && e.metaKey == !!modifiers.meta && e.shiftKey == !!modifiers.shift;
  }
  return e.altKey == !!modifiers.alt && e.ctrlKey == !!modifiers.ctrl && e.metaKey == !!modifiers.meta && e.shiftKey == !!modifiers.shift;
}