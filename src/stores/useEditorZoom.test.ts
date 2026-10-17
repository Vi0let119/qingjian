import { describe, expect, it } from "vitest";
import {
  clampZoom,
  useEditorZoomStore,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
} from "./useEditorZoom";

describe("clampZoom", () => {
  it("keeps values inside bounds", () => {
    expect(clampZoom(0.3)).toBe(ZOOM_MIN);
    expect(clampZoom(2.5)).toBe(ZOOM_MAX);
    expect(clampZoom(1.25)).toBe(1.25);
  });

  it("rounds away floating point drift", () => {
    expect(clampZoom(1.0000000002)).toBe(1);
    expect(clampZoom(0.9 + ZOOM_STEP)).toBe(1);
  });
});

describe("useEditorZoomStore", () => {
  it("steps up to the max, down to the min, and resets", () => {
    const store = useEditorZoomStore;
    store.getState().reset();
    for (let i = 0; i < 20; i++) store.getState().zoomIn();
    expect(store.getState().zoom).toBe(ZOOM_MAX);

    store.getState().reset();
    for (let i = 0; i < 20; i++) store.getState().zoomOut();
    expect(store.getState().zoom).toBe(ZOOM_MIN);

    store.getState().reset();
    expect(store.getState().zoom).toBe(1);
  });

  it("single step changes by ZOOM_STEP", () => {
    const store = useEditorZoomStore;
    store.getState().reset();
    store.getState().zoomIn();
    expect(store.getState().zoom).toBeCloseTo(1 + ZOOM_STEP, 5);
    store.getState().reset();
  });
});
