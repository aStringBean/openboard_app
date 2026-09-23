import { useCallback, useState } from "react";
import type { LayoutChangeEvent } from "react-native";

import { fitPhoto } from "../lib/fit";

/** Measures the canvas area and sizes the wall photo to fit inside it whole. */
export function useFitCanvas(aspect: number | null | undefined) {
  const [box, setBox] = useState({ w: 0, h: 0 });

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((b) => (b.w === width && b.h === height ? b : { w: width, h: height }));
  }, []);

  return { onLayout, ...fitPhoto(box.w, box.h, aspect ?? 0.75) };
}
