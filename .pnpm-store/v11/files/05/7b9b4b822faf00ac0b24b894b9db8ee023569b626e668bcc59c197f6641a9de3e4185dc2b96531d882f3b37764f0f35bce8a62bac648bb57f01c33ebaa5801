import { goUpByTheTree } from "../goUpByTheTree";
import { HtmlElementTreeNode } from "../HtmlElementTreeNode";
export function getElementInfo(found) {
  if (found.__svelte_meta) {
    const {
      loc
    } = found.__svelte_meta;
    return {
      thisElement: {
        box: found.getBoundingClientRect(),
        label: found.nodeName.toLowerCase(),
        link: {
          column: loc.column + 1,
          line: loc.line + 1,
          filePath: loc.file,
          projectPath: ""
        }
      },
      htmlElement: found,
      parentElements: [],
      componentBox: found.getBoundingClientRect(),
      componentsLabels: []
    };
  }
  return null;
}
export class SvelteTreeNodeElement extends HtmlElementTreeNode {
  getSource() {
    const element = this.element;
    if (element.__svelte_meta) {
      const {
        loc
      } = element.__svelte_meta;
      return {
        fileName: loc.file,
        lineNumber: loc.line + 1,
        columnNumber: loc.column + 1
      };
    }
    return null;
  }
  getComponent() {
    return null;
  }
}
function getTree(element) {
  const originalRoot = new SvelteTreeNodeElement(element);
  return goUpByTheTree(originalRoot);
}
function getParentsPaths(element) {
  const path = [];
  let currentElement = element;
  let maxDepth = 10000; // just in case, it should not be needed

  do {
    if (currentElement?.__svelte_meta) {
      const {
        loc
      } = currentElement.__svelte_meta;

      // we assume that there is one component per file
      const isSameFileAsTheLastOne = loc.file === path[path.length - 1]?.link?.filePath;
      if (!isSameFileAsTheLastOne) {
        path.push({
          title: currentElement.nodeName.toLowerCase(),
          link: {
            column: loc.column + 1,
            line: loc.line + 1,
            filePath: loc.file,
            projectPath: ""
          }
        });
      }
    }
    currentElement = currentElement.parentElement;
    maxDepth--;
    if (maxDepth < 0) {
      break;
    }
  } while (currentElement);
  return path;
}
const svelteAdapter = {
  getElementInfo,
  getTree,
  getParentsPaths
};
export default svelteAdapter;