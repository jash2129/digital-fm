export type CanvasElementSkeleton =
  | { type: "rectangle"; id: string; x: number; y: number; width: number; height: number }
  | { type: "text"; id: string; x: number; y: number; text: string; fontSize?: number };
