import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { overlayHost } from "../frame";

/**
 * react-native-web draws a Modal into document.body, i.e. over the whole page. In the demo it is
 * drawn into the phone frame's overlay layer instead, so a dialog covers the "phone" only.
 * (Replaces react-native-web/dist/exports/Modal/ModalPortal.)
 */
export default function ModalPortal({ children }: { children?: ReactNode }) {
  const [element] = useState(() => {
    const div = document.createElement("div");
    div.style.cssText = "position:absolute;inset:0;pointer-events:none";
    div.setAttribute("data-demo-modal", "");
    return div;
  });
  useLayoutEffect(() => {
    overlayHost().appendChild(element);
    return () => void element.remove();
  }, [element]);
  return createPortal(children, element);
}
