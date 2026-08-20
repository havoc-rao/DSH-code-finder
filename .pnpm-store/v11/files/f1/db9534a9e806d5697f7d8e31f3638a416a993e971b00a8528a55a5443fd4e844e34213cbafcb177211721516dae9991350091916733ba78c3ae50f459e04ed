"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDisallowedComponent = isDisallowedComponent;
const disallowedNames = {
    Fragment: true,
    "React.Fragment": true,
    Suspense: true,
    "React.Suspense": true,
};
function isDisallowedComponent(name) {
    return !!disallowedNames[name] || !!name.match(/Provider$/);
}
