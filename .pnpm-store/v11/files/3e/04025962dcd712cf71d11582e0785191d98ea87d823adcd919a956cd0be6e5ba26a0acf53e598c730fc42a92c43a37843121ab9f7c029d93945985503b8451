import { isValidRenderer } from "./isValidRenderer";
export * from "./types";
export const allTargets = {
    vscode: {
        url: "vscode://file/${projectPath}${filePath}:${line}:${column}",
        label: "VSCode",
    },
    webstorm: {
        url: "webstorm://open?file=${projectPath}${filePath}&line=${line}&column=${column}",
        label: "WebStorm",
    },
    cursor: {
        url: "cursor://file/${projectPath}${filePath}:${line}:${column}",
        label: "Cursor",
    },
    windsurf: {
        url: "windsurf://file/${projectPath}${filePath}:${line}:${column}",
        label: "Windsurf",
    },
};
export const isMac = 
// @ts-ignore
typeof navigator !== "undefined" &&
    // @ts-ignore
    navigator.platform.toUpperCase().indexOf("MAC") >= 0;
export const altTitle = isMac ? "⌥ Option" : "Alt";
export const shiftTitle = isMac ? "⇧ Shift" : "Shift";
export const ctrlTitle = isMac ? "⌃ Ctrl" : "Ctrl";
export const metaTitle = isMac ? "⌘ Command" : "Windows";
export const modifiersTitles = {
    alt: altTitle,
    ctrl: ctrlTitle,
    meta: metaTitle,
    shift: shiftTitle,
};
export function getModifiersMap(modifiersString) {
    const mouseModifiersArray = modifiersString.split("+").filter(Boolean);
    const modifiersMap = {};
    mouseModifiersArray.forEach((modifier) => {
        modifiersMap[modifier] = true;
    }, {});
    return modifiersMap;
}
export function getModifiersString(modifiersMap) {
    const modifiersArray = Object.keys(modifiersMap);
    return modifiersArray.join("+");
}
export function detectSvelte() {
    // @ts-ignore
    if (window.__SVELTE_HMR) {
        // __SVELTE_HMR is so far the only way to detect svelte I found
        return true;
    }
    // @ts-ignore
    if (window.__SAPPER__) {
        return true;
    }
    return false;
}
export function detectVue() {
    // @ts-ignore
    if (window.__VUE__) {
        return true;
    }
    return false;
}
export function detectJSX() {
    // @ts-ignore
    if (window.__LOCATOR_DATA__) {
        return true;
    }
    return false;
}
export function detectReact() {
    // @ts-ignore
    if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
        // @ts-ignore
        const renderersMap = window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers;
        if (renderersMap) {
            const problematicRenderers = [];
            const renderers = Array.from(renderersMap.values()).filter((renderer) => {
                return isValidRenderer(renderer, (msg) => {
                    problematicRenderers.push(msg);
                });
            });
            if (renderers.length) {
                return true;
            }
        }
    }
    return false;
}
export * from "./sharedOptionsStore";
