export {
  API2_MAX_POS,
  API2_REC_LEN,
  API3_MAX_POS,
  API3_REC_LEN,
  DEFAULT_API,
  MAX_DATA_LEN,
  MAX_PKT_LEN,
  type ApiLevel,
} from "./constants.js";
export { AuroraProtocolError, type AuroraErrorCode } from "./errors.js";
export { auroraCrc } from "./crc.js";
export { expand2, expand3, quantize } from "./color.js";
export {
  chunkPacket,
  encodeAllOff,
  encodeFrame,
  type EncodeOptions,
  type Led,
} from "./encode.js";
export {
  decodeFrame,
  decodePacket,
  inspect,
  verifyPacket,
  type DecodedLed,
  type FrameInfo,
} from "./decode.js";
export {
  ADVERTISED_AURORA_SERVICE_UUID,
  DEVICE_NAMES,
  NUS_RX_CHAR_UUID,
  NUS_SERVICE_UUID,
  NUS_TX_CHAR_UUID,
  type BoardMode,
} from "./ble.js";
