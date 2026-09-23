/**
 * Transport identifiers for reaching the controller.
 *
 * Every emulated board mode carries its payload over Nordic UART Service, so
 * one write characteristic serves all of them.
 *
 * Note the mismatch in the firmware's advertising data: in the Aurora modes it
 * advertises the vendor service UUID below, but only NUS is registered in the
 * GATT table. Scan on the device name or on NUS; do not expect to discover the
 * Aurora service after connecting.
 */
export const NUS_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";

/** Central → peripheral. Where frames are written. */
export const NUS_RX_CHAR_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";

/** Peripheral → central. Present, but the firmware never notifies on it today. */
export const NUS_TX_CHAR_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

/** Advertised in the Aurora modes, but absent from the GATT table. */
export const ADVERTISED_AURORA_SERVICE_UUID = "4488b571-7806-4df6-bcff-a2897e4953ff";

/** Advertised device name per board mode, from `bt_setup.c`. */
export const DEVICE_NAMES = {
  moon: "Moonboard",
  aurora: "Aurora Board#1@3",
  kilter: "Kilter Board#1@3",
  tension: "Tension Board#1@3",
  decoy: "Decoy Board#1@3",
  grasshopper: "Grasshopper Board#1@3",
} as const;

export type BoardMode = keyof typeof DEVICE_NAMES;
