import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import CScrollbar, { type CScrollbarHandle } from "./CScrollbar";

/**
 * Halo's Select and Combobox menus are portalled straight to <body>, so they cannot
 * be wrapped in a ScrollArea. This watches for those menus and floats the same
 * CScrollbar over each one, hiding the native bar underneath.
 */
const MENU_SELECTOR = '[data-part="menu"][role="listbox"]';
const HIDE_NATIVE = "menu-cscroll";
const BAR_WIDTH = 11;

const ids = new WeakMap<HTMLElement, number>();
let nextId = 0;

function idOf(element: HTMLElement) {
  let id = ids.get(element);
  if (id === undefined) {
    id = nextId++;
    ids.set(element, id);
  }
  return id;
}

export default function MenuScrollbars() {
  const [menus, setMenus] = useState<HTMLElement[]>([]);

  useEffect(() => {
    const scan = () => {
      const found = Array.from(document.querySelectorAll<HTMLElement>(MENU_SELECTOR));
      setMenus((current) =>
        current.length === found.length && current.every((element, index) => element === found[index]) ? current : found,
      );
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return (
    <>
      {menus.map((menu) => (
        <MenuBar key={idOf(menu)} element={menu} />
      ))}
    </>
  );
}

function MenuBar({ element }: { element: HTMLElement }) {
  const barRef = useRef<CScrollbarHandle>(null);
  const [host] = useState(() => {
    const node = document.createElement("div");
    node.className = "menu-cscroll-host";
    return node;
  });

  useEffect(() => {
    document.body.appendChild(host);
    element.classList.add(HIDE_NATIVE);

    // Floating UI moves the menu with inline styles after it opens, and the menu scrolls
    // on its own, so both are followed. The frame loop covers moves that fire no event.
    const place = () => {
      const rect = element.getBoundingClientRect();
      host.style.top = `${rect.top}px`;
      host.style.left = `${rect.right - BAR_WIDTH}px`;
      host.style.height = `${Math.max(0, element.clientHeight)}px`;
      host.style.display = element.isConnected && rect.height > 0 ? "" : "none";
      barRef.current?.update(
        element.scrollTop,
        Math.max(0, element.scrollHeight - element.clientHeight),
        element.clientHeight,
      );
    };

    place();
    let frame = requestAnimationFrame(function follow() {
      place();
      frame = requestAnimationFrame(follow);
    });

    const resize = new ResizeObserver(place);
    resize.observe(element);
    const content = new MutationObserver(place);
    content.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["style", "class"],
    });
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      content.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      element.classList.remove(HIDE_NATIVE);
      host.remove();
    };
  }, [element, host]);

  return createPortal(
    <CScrollbar
      ref={barRef}
      orientation="vertical"
      onScroll={(position) => {
        element.scrollTop = position;
      }}
    />,
    host,
  );
}
