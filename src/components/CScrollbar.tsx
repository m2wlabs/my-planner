import { useCallback, useEffect, useImperativeHandle, useRef, type Ref } from "react";

export type CScrollbarHandle = {
  update: (position: number, bounds: number, viewport: number) => void;
};

type Orientation = "vertical" | "horizontal";

const THUMB_INSET = 4;
const MIN_THUMB = 24;

function extentOf(element: HTMLElement, vertical: boolean): number {
  return vertical ? element.clientHeight : element.clientWidth;
}

function travelOf(track: HTMLElement, thumb: HTMLElement, vertical: boolean): number {
  return Math.max(0, extentOf(track, vertical) - extentOf(thumb, vertical) - THUMB_INSET);
}

function offsetFor(track: HTMLElement, thumb: HTMLElement, vertical: boolean, position: number, bounds: number): number {
  const travel = travelOf(track, thumb, vertical);
  if (bounds <= 0 || travel <= 0) return 0;
  return (position / bounds) * travel;
}

function thumbExtentOf(track: HTMLElement, vertical: boolean, viewport: number, bounds: number): number {
  const trackExtent = extentOf(track, vertical);
  const content = bounds + viewport;
  if (viewport <= 0 || content <= 0) return trackExtent;
  const raw = (trackExtent * viewport) / content;
  return Math.round(Math.max(MIN_THUMB, Math.min(trackExtent - THUMB_INSET, raw)));
}

export default function CScrollbar({
  orientation = "vertical",
  onScroll,
  ref,
}: {
  orientation?: Orientation;
  onScroll: (position: number) => void;
  ref?: Ref<CScrollbarHandle>;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const boundsRef = useRef(0);
  const positionRef = useRef(0);
  const viewportRef = useRef(0);
  const grabRef = useRef(0);
  const draggingRef = useRef(false);
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRef = useRef<number | null>(null);
  const onScrollRef = useRef(onScroll);

  const vertical = orientation === "vertical";

  useEffect(() => {
    onScrollRef.current = onScroll;
  });

  /** Draws the thumb from the last position: also called when the track itself resizes. */
  const paint = useCallback(() => {
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!track || !thumb || viewportRef.current <= 0) return;

    const position = positionRef.current;
    const bounds = boundsRef.current;
    const viewport = viewportRef.current;
    const scrollable = bounds > 0;
    track.classList.toggle("cscrollbar--hidden", !scrollable);
    if (!scrollable) return;

    const extent = thumbExtentOf(track, vertical, viewport, bounds);
    if (vertical) {
      thumb.style.height = `${extent}px`;
    } else {
      thumb.style.width = `${extent}px`;
    }

    const offset = offsetFor(track, thumb, vertical, position, bounds);
    thumb.style.transform = vertical
      ? `translate3d(0px, ${offset.toFixed(2)}px, 0px)`
      : `translate3d(${offset.toFixed(2)}px, 0px, 0px)`;

    if (lastRef.current === null || Math.abs(position - lastRef.current) > 0.1) {
      track.classList.add("cscrollbar--scrolling");
      if (idleRef.current) clearTimeout(idleRef.current);
      idleRef.current = setTimeout(() => track.classList.remove("cscrollbar--scrolling"), 140);
    }
    lastRef.current = position;
  }, [vertical]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const observer = new ResizeObserver(paint);
    observer.observe(track);
    return () => observer.disconnect();
  }, [paint]);

  useEffect(() => {
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!track || !thumb) return;

    function pointerWithinTrack(event: PointerEvent) {
      const rect = track!.getBoundingClientRect();
      return vertical ? event.clientY - rect.top : event.clientX - rect.left;
    }

    function onPointerDown(event: PointerEvent) {
      if (boundsRef.current <= 0 || travelOf(track!, thumb!, vertical) <= 0) return;
      event.preventDefault();
      event.stopPropagation();
      grabRef.current = pointerWithinTrack(event) - offsetFor(track!, thumb!, vertical, positionRef.current, boundsRef.current);
      draggingRef.current = true;
      track!.classList.add("cscrollbar--dragging");
      document.body.style.cursor = "grabbing";
    }

    function onPointerMove(event: PointerEvent) {
      if (!draggingRef.current) return;
      const travel = travelOf(track!, thumb!, vertical);
      if (travel <= 0) return;
      const offset = Math.min(travel, Math.max(0, pointerWithinTrack(event) - grabRef.current));
      onScrollRef.current((offset / travel) * boundsRef.current);
    }

    function onPointerUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      track!.classList.remove("cscrollbar--dragging");
      document.body.style.cursor = "";
    }

    thumb.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    return () => {
      thumb.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      if (idleRef.current) clearTimeout(idleRef.current);
      document.body.style.cursor = "";
    };
  }, [vertical]);

  useImperativeHandle(
    ref,
    () => ({
      update(position: number, bounds: number, viewport: number) {
        positionRef.current = position;
        boundsRef.current = bounds;
        viewportRef.current = viewport;
        paint();
      },
    }),
    [paint],
  );

  return (
    <div ref={trackRef} className={`cscrollbar cscrollbar--${orientation}`} aria-hidden="true">
      <div ref={thumbRef} className="cscrollbar__thumb" />
    </div>
  );
}
