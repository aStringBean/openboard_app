# @openboard/openboard-protocol

Codec for **OpenBoard API 1**, the native protocol of the `open_board_leds`
firmware: full 24-bit colour, settings over Bluetooth, and replies from the
board. The specification lives in the firmware repository,
`docs/openboard-api-1.md`; section numbers in the source refer to it.

Only a board in OpenBoard mode (`board setup openboard`, advertising as
`OpenBoard`) speaks it. Boards advertising an Aurora-family name speak Aurora
only — use `@openboard/aurora-protocol` for those.

Zero dependencies; runs in React Native and Node.

## Use

```ts
import { DEVICE_NAME, Session } from "@openboard/openboard-protocol";

// write: one whole packet to NUS RX, split into MTU-sized writes.
const session = new Session({ write: (packet) => writeToRx(packet) });
onTxNotification((bytes) => session.receive(bytes));

const info = await session.getInfo(); // firmware version, features, …
await session.setBrightness(128);
session.onFrameEvent((e) => console.log(e)); // frameShown, frameDropped
await session.showFrame([{ pos: 0, r: 255, g: 128, b: 0 }]);
```

Lower-level pieces are exported too: `encodeFrame`, the `encode*` command
functions, `decodeMessage`, `pack`/`unpack`/`chunk`, and `PacketReader` for
reassembling notifications.

## Tests

```shell
npm test          # includes the spec's worked examples, byte for byte
npm run check     # against a real board in OpenBoard mode, over BLE (needs uv)
```

The firmware's `tests/openboard` checks the same example bytes, so the two
sides cannot drift apart unnoticed.
