import { evalTemplate } from "./evalTemplate";
import { linkTemplateUrl } from "./linkTemplateUrl";
import { transformPath } from "./transformPath";
let internalProjectPath = null;
export function setInternalProjectPath(projectPath) {
  internalProjectPath = projectPath;
}
export function getSavedProjectPath(options) {
  return options.getOptions().projectPath || internalProjectPath;
}
export function buildLink(linkProps, targets, options, localLinkTypeOrTemplate) {
  const params = {
    filePath: linkProps.filePath,
    projectPath: getSavedProjectPath(options) || linkProps.projectPath,
    line: String(linkProps.line),
    column: String(linkProps.column),
    linePlusOne: String(linkProps.line + 1),
    columnPlusOne: String(linkProps.column + 1),
    lineMinusOne: String(linkProps.line - 1),
    columnMinusOne: String(linkProps.column - 1)
  };
  const template = linkTemplateUrl(targets, options, localLinkTypeOrTemplate);
  const replacePathObj = options.getOptions().replacePath;
  let evaluated = evalTemplate(template, params);
  if (replacePathObj) {
    evaluated = transformPath(evaluated, replacePathObj.from, replacePathObj.to);
  }
  return evaluated;
}
export function buildLinkFromSource(source, targets, options) {
  return buildLink({
    filePath: source.fileName,
    projectPath: source.projectPath || "",
    line: source.lineNumber,
    column: source.columnNumber || 0
  }, targets, options);
}