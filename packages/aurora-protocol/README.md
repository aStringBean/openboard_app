# @openboard/aurora-protocol

Encoder and decoder for the Aurora LED wire protocol spoken by the
[`open_board_leds`](../../../zpehyr_workspace/open_board_leds) controller.

Zero dependencies, pure `Uint8Array`. No BLE, no React Native, no DOM — the
transport layer is the caller's problem, which keeps this testable in Node.

```ts
import { encodeFrame, chunkPacket, NUS_RX_CHAR_UUID } from "@openboard/aurora-protocol";

const packets = encodeFrame([
  { pos: 12, r: 0, g: 255, b: 0 },   // start
  { pos: 47, r: 0, g: 0, b: 255 },   // hand
  { pos: 91, r: 255, g: 0, b: 0 },   // finish
]);

for (const packet of packets) {
  for (const chunk of chunkPacket(packet, mtu - 3)) {
    await device.writeCharacteristicWithoutResponse(NUS_RX_CHAR_UUID, chunk);
  }
}
```

## Frames are absolute

A frame is the complete set of lit LEDs, not a delta. The firmware clears the
strip on a message's opening packet and pushes it on the closing one, so any LED
not listed goes dark. `encodeFrame([])` — or `encodeAllOff()` — blanks the wall.

Packets from one call must be written **in order** and not interleaved with
another frame's, or the controller will paint a mix of the two.

## Wire format

Ported from `app/src/aurora.c` and `app/src/parse.c`. Constants live in
`src/constants.ts`; changing them without changing the firmware breaks the link.

```
01 | dataLen | crc | 02 | seq | records… | 03
```

- `dataLen` counts `seq` plus the records, so the packet is `dataLen + 5` bytes.
  It is one octet, capping a packet at 260 bytes.
- `crc` is the additive inverse of the payload sum, **including** `seq`.
- `seq` names both the API level and the packet's place in a fragmented message:

  | | middle | first | last | only |
  | --- | --- | --- | --- | --- |
  | API 2 | `0x4D` | `0x4E` | `0x4F` | `0x50` |
  | API 3 | `0x51` | `0x52` | `0x53` | `0x54` |

- A trailing partial record is ignored rather than rejected.

### Records

**API 3** (default) — 3 bytes: position little-endian `uint16`, then a colour
byte `rrrgggbb`. Up to 65535 LEDs, 84 records per packet.

**API 2** — 2 bytes: position low byte, then `pprrggbb` where `pp` is the top of
a 10-bit position. Up to 1024 LEDs, 127 records per packet. Supported for
completeness; there is no reason to use it on a custom wall.

### Colour fidelity

API 3 gives 8 red levels, 8 green, and only **4 blue**. Channels expand by bit
replication, so a packed field of all ones reaches `0xFF` exactly. These survive
the round trip unchanged, and the app's role palette should be drawn from them:

`#000000` `#FF0000` `#00FF00` `#0000FF` `#FFFF00` `#FF00FF` `#00FFFF` `#FFFFFF`

Anything else is quantised — up to ~18 off per red/green channel and ~42 on
blue. `decodeFrame(encodeFrame(leds))` tells you exactly what the wall will show.

Separately, the firmware scales every channel down by `255 / CONFIG_LED_BRIGHTNESS`
(3 at the default brightness of 64) before driving the strip, so output is dimmer
than requested. That is a firmware-side concern, not something this codec models.

## Transport notes

- All board modes carry their payload over **Nordic UART Service**; write frames
  to `NUS_RX_CHAR_UUID` without response.
- In the Aurora modes the firmware advertises `4488B571-…` but **only registers
  NUS in the GATT table**. Scan on the device name or on NUS; do not expect to
  discover the advertised service after connecting.
- The firmware never notifies — there is no ack and no way to read back chain
  length or board mode. Writes are fire-and-forget.
- **The controller negotiates an ATT MTU of 247**, so a single write carries up
  to 244 bytes. Pass `maxPacketBytes: mtu - 3` to `encodeFrame` and each packet
  is exactly one write — a 250-LED frame costs 4 writes. Firmware older than
  2026-09-21 capped the MTU at Zephyr's default of 23 (20-byte writes, 39 per
  frame); `chunkPacket` handles that case transparently.
- The controller reassembles across writes with a 512-byte ring buffer and
  resynchronises on the start byte, so chunking mid-packet is safe.

## API

| | |
| --- | --- |
| `encodeFrame(leds, opts?)` | Frame → packets. `opts.api` (2 or 3), `opts.maxPacketBytes`. |
| `encodeAllOff(opts?)` | Single packet that blanks the wall. |
| `chunkPacket(packet, maxWriteBytes)` | Split a packet into BLE writes. |
| `decodePacket(packet)` | One packet → its LED records. |
| `decodeFrame(packets)` | Reassemble a frame as the firmware would. |
| `inspect(packet)` | `{ api, first, last }` without decoding records. |
| `verifyPacket(packet)` | Full validation: framing, length, stop byte, checksum. |
| `auroraCrc(payload)` | The checksum on its own. |
| `quantize` / `expand2` / `expand3` | Colour narrowing and its inverse. |

Faults throw `AuroraProtocolError` with `code` of `EINVAL` (framing) or `EPROTO`
(unknown sequence byte), mirroring the firmware's errno returns. Caller mistakes
— a position out of range, a non-integer channel — throw `RangeError`.

## Tests

```shell
npm test
npm run typecheck
```

The decoder suite is ported vector-for-vector from the firmware's
`tests/parse/src/main.c`, including the documented `01 04 c8 02 54 00 00 e3 03`
packet, so a divergence between this codec and the controller shows up here
rather than on the wall.

## Lighting a real board

`tools/` is a smoke-test harness for the physical controller. Node generates
the frames with this package, Python pushes the bytes — nothing is encoded
twice, so whatever appears on the wall is genuinely this codec's output.

```shell
npm run smoke              # build, generate a show, scan, connect, send
```

It scans for any Aurora-family name; pass `--address <mac>` to skip scanning.
Generate a show without sending with `npm run frames`.

The board must be in an Aurora-family mode. Set it over the USB shell — the
setting persists across resets, and there is no way to read it back over BLE,
so scanning for the advertised name is how you find out which mode it is in:

```shell
board setup aurora          # or kilter / tension / decoy / grasshopper
led_strip chain_length      # how many LEDs are driven
```

Requires `uv` for the ephemeral `bleak` environment. Packets are written in
20-byte chunks and the firmware reassembles them — the same path the mobile app
takes, because **the controller caps the ATT MTU at 23** (see below).
