export const getLinkTypeOrTemplate = (targets, options, localLinkTypeOrTemplate) => localLinkTypeOrTemplate || options.getOptions().templateOrTemplateId || document.documentElement.dataset.locatorTarget || Object.entries(targets)[0][0];
export function linkTemplateUrl(targets, options, localLinkTypeOrTemplate) {
  const templateOrType = getLinkTypeOrTemplate(targets, options, localLinkTypeOrTemplate);
  const target = targets[templateOrType];
  if (target) {
    return target.url;
  }
  return templateOrType;
}