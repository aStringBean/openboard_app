export {
  API_VERSION,
  BOARD_TYPES,
  DEVICE_NAME,
  DROP_REASON,
  ERROR_CODE,
  FEATURE,
  MAX_PACKET_LEN,
  MAX_PAYLOAD_LEN,
  MAX_POS,
  MAX_RECORDS,
  MSG,
  NUS_RX_CHAR_UUID,
  NUS_SERVICE_UUID,
  NUS_TX_CHAR_UUID,
  OPCODE,
  RECORD_LEN,
  REPLY,
  SETTING,
  type BoardType,
  type DropReasonName,
  type ErrorCodeName,
} from "./constants.js";
export { OpenBoardProtocolError } from "./errors.js";
export { checksum, chunk, pack, PacketReader, unpack } from "./envelope.js";
export {
  encodeFrame,
  encodeGetInfo,
  encodeGetSettings,
  encodeSetBrightness,
  encodeSetChainLength,
  encodeSetColorOrder,
  type Led,
} from "./encode.js";
export { decodeMessage, type Info, type Message, type Settings } from "./decode.js";
export {
  CommandError,
  CommandTimeout,
  Session,
  type FrameEvent,
  type Transport,
} from "./session.js";
