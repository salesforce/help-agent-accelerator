import { LightningElement, api } from "lwc";

export default class HaaSkeletonLoader extends LightningElement {
  @api reverse = false;

  get wrapperClass() {
    let cls = "skeleton-wrapper";
    if (this.reverse === true || this.reverse === "true") {
      cls += " skeleton-wrapper-reverse";
    }
    return cls;
  }
}