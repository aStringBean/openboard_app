export const theme = {
  bg: "#12141a",
  panel: "#1a1d26",
  line: "#2a2f3d",
  text: "#e4e7ef",
  dim: "#8b93a7",
  accent: "#5b9dff",
  good: "#3ddc84",
  warn: "#ffb020",
  danger: "#ff5f56",
} as const;

/** Used during calibration and verification, also exactly representable. */
export const CALIBRATION_COLOUR = { r: 255, g: 255, b: 255 };
export const VERIFY_COLOUR = { r: 0, g: 255, b: 255 };
