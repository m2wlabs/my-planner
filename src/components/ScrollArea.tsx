import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import CScrollbar, { type CScrollbarHandle } from "./CScrollbar";

export default function ScrollArea({
  children,
  className,
  pan = false,
  regionRef,
}: {
  children: ReactNode;
  className?: string;
  /** Pans the content sideways with the vertical bar instead of scrolling up and down. */
  pan?: boolean;
  /** Hands the scrolling element to the parent, e.g. to scroll to a column. */
  regionRef?: RefObject<HTMLDivElement | null>;
}) {
  const localRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<CScrollbarHandle>(null);

  const sync = useCallback(() => {
    const element = localRef.current;
    if (!element) return;
    if (pan) {
      barRef.current?.update(
        element.scrollLeft,
        Math.max(0, element.scrollWidth - element.clientWidth),
        element.clientWidth,
      );
      return;
    }
    barRef.current?.update(
      element.scrollTop,
      Math.max(0, element.scrollHeight - element.clientHeight),
      element.clientHeight,
    );
  }, [pan]);

  // The mouse wheel pans the content sideways. React's onWheel is passive, so the
  // listener is attached by hand: the wheel has to be cancelled to stop the page
  // from scrolling underneath.
  useEffect(() => {
    if (!pan) return;
    const element = localRef.current;
    if (!element) return;

    function onWheel(event: WheelEvent) {
      const max = element!.scrollWidth - element!.clientWidth;
      if (max <= 0) return;
      // A sideways gesture already scrolls the region natively.
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      if (event.shiftKey) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element!.clientWidth : 1;
      const next = element!.scrollLeft + event.deltaY * unit;
      // At either end the wheel belongs to the page again.
      if (next <= 0 || next >= max) return;
      event.preventDefault();
      element!.scrollLeft = next;
      // Move the bar in the same tick; the scroll event only follows later.
      sync();
    }

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [pan, sync]);

  useLayoutEffect(() => {
    const element = localRef.current;
    if (!element) return;

    sync();
    const resize = new ResizeObserver(sync);
    resize.observe(element);
    if (element.firstElementChild) resize.observe(element.firstElementChild);
    const mutations = new MutationObserver(sync);
    mutations.observe(element, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["style"] });

    return () => {
      resize.disconnect();
      mutations.disconnect();
    };
  }, [sync]);

  return (
    <div className={`scroll-area${pan ? " scroll-area--pan" : ""}${className ? ` ${className}` : ""}`}>
      <div
        ref={(node) => {
          localRef.current = node;
          if (regionRef) regionRef.current = node;
        }}
        className="scroll-area__region"
        onScroll={sync}
        tabIndex={0}
      >
        {children}
      </div>
      <CScrollbar
        ref={barRef}
        orientation="vertical"
        onScroll={(position) => {
          const element = localRef.current;
          if (!element) return;
          if (pan) {
            if (element.scrollLeft !== position) element.scrollLeft = position;
            return;
          }
          if (element.scrollTop !== position) element.scrollTop = position;
        }}
      />
    </div>
  );
}
