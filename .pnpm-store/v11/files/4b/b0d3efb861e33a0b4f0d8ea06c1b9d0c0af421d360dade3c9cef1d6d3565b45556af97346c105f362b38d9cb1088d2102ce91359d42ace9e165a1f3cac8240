import { buildLinkFromSource, buildLink } from "./buildLink";
import { HREF_TARGET } from "../consts";
export function goTo(link, options) {
  window.open(link, options.getOptions().hrefTarget);
}
export function goToLinkProps(linkProps, targets, options) {
  const link = buildLink(linkProps, targets, options);
  window.open(link, options.getOptions().hrefTarget || HREF_TARGET);
}
export function goToSource(source, targets, options) {
  return goTo(buildLinkFromSource(source, targets, options), options);
}