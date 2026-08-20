"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = transformLocatorJsComponents;
const parser_1 = require("@babel/parser");
const isDisallowedComponent_1 = require("./isDisallowedComponent");
function transformLocatorJsComponents(babel) {
    // there was some weird caching error when using babel.env() on Vite
    // Vite has NODE_ENV undefined when doing first dev build
    const env = process.env.BABEL_ENV || process.env.NODE_ENV || "development";
    const t = babel.types;
    let fileStorage = null;
    let wrappingComponent = null;
    let lastComponentId = 0;
    let lastExpressionId = 0;
    let lastStyledId = 0;
    let currentWrappingComponentId = null;
    function addExpressionToStorage(expression) {
        if (fileStorage) {
            const id = lastExpressionId;
            fileStorage.expressions[id] = expression;
            lastExpressionId++;
            return id;
        }
        else {
            throw new Error("No fileStorage");
        }
    }
    function addStyledToStorage(styled) {
        if (fileStorage) {
            const id = lastStyledId;
            fileStorage.styledDefinitions[id] = styled;
            lastStyledId++;
            return id;
        }
        else {
            throw new Error("No fileStorage");
        }
    }
    function addComponentToStorage(component) {
        if (fileStorage) {
            const id = lastComponentId;
            fileStorage.components[id] = component;
            lastComponentId++;
            return id;
        }
        else {
            throw new Error("No fileStorage");
        }
    }
    return {
        visitor: {
            Program: {
                // TODO state is any, we should check if the state depends on webpack or what it depends on?
                enter(path, state) {
                    function isLocallyDisallowedComponent(name) {
                        const opts = state?.opts?.ignoreComponentNames || [];
                        return opts.includes(name);
                    }
                    if (state.opts?.env) {
                        if (state.opts?.env !== env) {
                            return;
                        }
                    }
                    lastComponentId = 0;
                    lastExpressionId = 0;
                    lastStyledId = 0;
                    if (!state?.filename) {
                        throw new Error("No file name");
                    }
                    if (state.filename.includes("node_modules")) {
                        fileStorage = null;
                    }
                    else {
                        fileStorage = {
                            filePath: state.filename.replace(state.cwd, ""),
                            projectPath: state.cwd,
                            expressions: [],
                            styledDefinitions: [],
                            components: [],
                        };
                    }
                    // NEED TO RUN MANUAL TRAVERSE, SO IT MAKE EDITS BEFORE ALL OTHER PLUGINS
                    path.traverse({
                        // TODO add also for arrow function and class components
                        FunctionDeclaration: {
                            enter(path, state) {
                                if (!fileStorage) {
                                    return;
                                }
                                if (!path || !path.node || !path.node.id || !path.node.loc) {
                                    return;
                                }
                                const name = path.node.id.name;
                                wrappingComponent = {
                                    name,
                                    locString: path.node.loc.start.line + ":" + path.node.loc.start.column,
                                    loc: path.node.loc,
                                };
                                currentWrappingComponentId =
                                    addComponentToStorage(wrappingComponent);
                            },
                            exit(path, state) {
                                if (!fileStorage) {
                                    return;
                                }
                                if (!path || !path.node || !path.node.id || !path.node.loc) {
                                    return;
                                }
                                const name = path.node.id.name;
                                // Reset wrapping component
                                if (wrappingComponent &&
                                    wrappingComponent.name === name &&
                                    wrappingComponent.locString ===
                                        path.node.loc.start.line + ":" + path.node.loc.start.column) {
                                    wrappingComponent = null;
                                }
                            },
                        },
                        TaggedTemplateExpression(path) {
                            if (!fileStorage) {
                                return;
                            }
                            const tag = path.node.tag;
                            if (tag.type === "MemberExpression") {
                                const property = tag.property;
                                const object = tag.object;
                                if (object.type === "Identifier" &&
                                    object.name === "styled" &&
                                    property.type === "Identifier") {
                                    let name = null;
                                    const parent = path.parent;
                                    if (parent.type === "VariableDeclarator") {
                                        if (parent.id.type === "Identifier") {
                                            name = parent.id.name;
                                        }
                                    }
                                    if (path.node.loc) {
                                        const id = addStyledToStorage({
                                            name: name,
                                            loc: path.node.loc,
                                            htmlTag: property.name,
                                        });
                                        path.node.tag = t.callExpression(t.memberExpression(tag, t.identifier("attrs")), [
                                            t.arrowFunctionExpression([], t.objectExpression([
                                                t.objectProperty(t.stringLiteral("data-locatorjs-styled"), t.stringLiteral(createDataId(fileStorage, id))),
                                            ])),
                                        ]);
                                    }
                                }
                            }
                        },
                        JSXElement(path) {
                            if (!fileStorage) {
                                return;
                            }
                            function getName(el) {
                                if (el.type === "JSXIdentifier") {
                                    return el.name;
                                }
                                else if (el.type === "JSXMemberExpression") {
                                    return getName(el.object) + "." + el.property.name;
                                }
                                else if (el.type === "JSXNamespacedName") {
                                    return el.namespace.name + "." + el.name.name;
                                }
                                return "";
                            }
                            const name = getName(path.node.openingElement.name);
                            if (name &&
                                !(0, isDisallowedComponent_1.isDisallowedComponent)(name) &&
                                !isLocallyDisallowedComponent(name)) {
                                if (path.node.loc) {
                                    const dataAttributeMode = state?.opts?.dataAttribute || "id";
                                    // Always add to storage for window.__LOCATOR_DATA__
                                    const id = addExpressionToStorage({
                                        name: name,
                                        loc: path.node.loc,
                                        wrappingComponentId: currentWrappingComponentId,
                                    });
                                    let newAttr;
                                    if (dataAttributeMode === "path") {
                                        // Generate data-locatorjs with full path
                                        newAttr = t.jSXAttribute(t.jSXIdentifier("data-locatorjs"), t.jSXExpressionContainer(t.stringLiteral(createFullPathWithLocation(fileStorage, path.node.loc))));
                                    }
                                    else {
                                        // Default: generate data-locatorjs-id with ID
                                        newAttr = t.jSXAttribute(t.jSXIdentifier("data-locatorjs-id"), t.jSXExpressionContainer(t.stringLiteral(
                                        // this is stored by projectPath+filePath because that's the only unique identifier
                                        createDataId(fileStorage, id))
                                        // t.ObjectExpression([
                                        // ])
                                        ));
                                    }
                                    path.node.openingElement.attributes.push(newAttr);
                                }
                            }
                        },
                    });
                },
                exit(path, state) {
                    if (state.opts?.env) {
                        if (state.opts.env !== env) {
                            return;
                        }
                    }
                    if (!fileStorage) {
                        return;
                    }
                    const dataCode = JSON.stringify(fileStorage);
                    const dataAst = (0, parser_1.parseExpression)(dataCode, {
                        sourceType: "script",
                    });
                    const insertCode = `(() => {
            if (typeof window !== "undefined") {
              window.__LOCATOR_DATA__ = window.__LOCATOR_DATA__ || {};
              window.__LOCATOR_DATA__["${createFullPath(fileStorage)}"] = ${dataCode};
            }
          })()`;
                    // `function __bindLocatorExpression(id) {
                    //   return require("@locator/runtime").__bindLocatorExpression(${createFullPath(
                    //     fileStorage
                    //   )}, id);
                    // }`;
                    const insertAst = (0, parser_1.parseExpression)(insertCode, {
                        sourceType: "script",
                    });
                    path.node.body.push(t.expressionStatement(insertAst));
                },
            },
        },
    };
}
function createDataId(fileStorage, id) {
    return createFullPath(fileStorage) + "::" + String(id);
}
function createFullPath(fileStorage) {
    return fileStorage.projectPath + fileStorage.filePath;
}
function createFullPathWithLocation(fileStorage, loc) {
    return `${fileStorage.projectPath}${fileStorage.filePath}:${loc.start.line}:${loc.start.column}`;
}
