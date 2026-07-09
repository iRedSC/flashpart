import * as React from "react";

export type VisualViewportKeyboard = {
  /** Pixels covered by the keyboard (and any visual-viewport offset). */
  inset: number;
  /** Currently visible viewport height in CSS pixels. */
  visibleHeight: number;
};

const CLOSED: VisualViewportKeyboard = {
  inset: 0,
  visibleHeight: typeof window === "undefined" ? 0 : window.innerHeight,
};

/**
 * Tracks how much of the layout viewport is covered by the on-screen keyboard
 * (and iOS visual-viewport scroll). Use `inset` as `bottom` on fixed bottom
 * sheets so they sit above the keyboard.
 */
export function useVisualViewportKeyboard(enabled: boolean): VisualViewportKeyboard {
  const [state, setState] = React.useState<VisualViewportKeyboard>(CLOSED);

  React.useEffect(() => {
    if (!enabled) {
      setState(CLOSED);
      return;
    }

    const viewport = window.visualViewport;
    if (!viewport) {
      return;
    }

    let frame = 0;

    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const visibleHeight = viewport.height;
        const inset = Math.max(
          0,
          window.innerHeight - visibleHeight - viewport.offsetTop,
        );

        setState((previous) => {
          if (
            previous.inset === inset &&
            previous.visibleHeight === visibleHeight
          ) {
            return previous;
          }

          return { inset, visibleHeight };
        });
      });
    };

    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    window.addEventListener("resize", update);

    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [enabled]);

  return enabled ? state : CLOSED;
}
