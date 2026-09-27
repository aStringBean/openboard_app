#!/usr/bin/env python3
"""
Checks a board in OpenBoard mode against OpenBoard API 1, over BLE.

Encodes its own packets from the spec (the firmware's
docs/openboard-api-1.md), independently of the app's encoder, and checks
every reply. Leaves the board's brightness as it found it and the strip dark.

    uv run --with bleak tools/openboard_check.py [--address XX:..]
    uv run --with bleak tools/openboard_check.py --aurora-mode
"""

import argparse
import asyncio
import sys

from bleak import BleakClient, BleakScanner

NUS_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
NUS_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

MIDDLE, FIRST, LAST, ONLY, COMMAND, REPLY = 0xB0, 0xB1, 0xB2, 0xB3, 0xB8, 0xB9
OK, ERROR, INFO, SETTINGS, SHOWN, DROPPED = 0x01, 0x02, 0x03, 0x04, 0x10, 0x11


def pack(payload: bytes) -> bytes:
    crc = (~sum(payload)) & 0xFF
    return bytes([0x01, len(payload), crc, 0x02]) + payload + b"\x03"


def unpack(packet: bytes) -> bytes:
    assert packet[0] == 0x01 and packet[3] == 0x02 and packet[-1] == 0x03, packet.hex()
    payload = packet[4 : 4 + packet[1]]
    assert (~sum(payload)) & 0xFF == packet[2], f"bad checksum: {packet.hex()}"
    return payload


def frame_packets(frame_id: int, leds: list) -> list:
    """leds: [(pos, r, g, b)] -> packets of up to 50 records."""
    chunks = [leds[i : i + 50] for i in range(0, len(leds), 50)] or [[]]
    out = []
    for n, chunk in enumerate(chunks):
        if len(chunks) == 1:
            seq = ONLY
        elif n == 0:
            seq = FIRST
        elif n == len(chunks) - 1:
            seq = LAST
        else:
            seq = MIDDLE
        body = b"".join(bytes([p & 0xFF, p >> 8, r, g, b]) for p, r, g, b in chunk)
        out.append(pack(bytes([seq, frame_id]) + body))
    return out


class Board:
    def __init__(self, client):
        self.client = client
        self.replies = asyncio.Queue()
        self.chunk = 20  # safe whatever MTU BlueZ settled on
        self.req = 0

    async def start(self):
        await self.client.start_notify(NUS_TX, self._on_notify)
        self.chunk = max(20, self.client.mtu_size - 3)

    def _on_notify(self, _char, data: bytearray):
        self.replies.put_nowait(unpack(bytes(data)))

    async def write(self, packet: bytes):
        for i in range(0, len(packet), self.chunk):
            await self.client.write_gatt_char(NUS_RX, packet[i : i + self.chunk], response=False)
            await asyncio.sleep(0.01)
        # One packet per write, as the spec asks: let it land before the next.
        await asyncio.sleep(0.03)

    async def reply(self, timeout=2.0) -> bytes:
        return await asyncio.wait_for(self.replies.get(), timeout)

    async def silence(self, seconds=0.5) -> bool:
        try:
            got = await asyncio.wait_for(self.replies.get(), seconds)
            print(f"  unexpected reply: {got.hex()}")
            return False
        except asyncio.TimeoutError:
            return True

    async def command(self, op: int, args: bytes = b"") -> bytes:
        self.req = (self.req + 1) & 0xFF
        await self.write(pack(bytes([COMMAND, self.req, op]) + args))
        r = await self.reply()
        assert r[0] == REPLY and r[2] == self.req, f"reply to request {self.req}: {r.hex()}"
        return r


failures = 0


def check(what: str, ok: bool, detail: str = ""):
    global failures
    print(f"  {'ok  ' if ok else 'FAIL'} {what}{'  ' + detail if detail else ''}")
    if not ok:
        failures += 1


async def run(board: Board, look: float):
    le16 = lambda b, i: b[i] | (b[i + 1] << 8)

    print("GET_INFO")
    r = await board.command(0x01)
    check("INFO reply", r[1] == INFO, r.hex())
    check("API version 1", r[3] == 1)
    print(f"       firmware {r[4]}.{r[5]}.{r[6]}, up to {le16(r, 7)} LEDs, "
          f"features 0x{le16(r, 9):04x}, board type {r[11]}, {r[12]} records/packet")
    check("board type OPENBOARD (6)", r[11] == 6)
    check("50 records per packet", r[12] == 50)
    check("frames, settings, events, power limit; no gamma", le16(r, 9) == 0x000F)

    print("GET_SETTINGS")
    s = await board.command(0x02)
    check("SETTINGS reply", s[1] == SETTINGS, s.hex())
    brightness, chain = s[3], le16(s, 4)
    print(f"       brightness {brightness}, chain {chain}, order {'grb' if s[6] else 'rgb'}, "
          f"supply {le16(s, 8)} W, headroom {s[10]} %, gamma {s[11]}")

    print("SET_SETTING")
    r = await board.command(0x03, bytes([0x01, 77]))
    check("brightness 77 accepted", r[1] == OK, r.hex())
    s2 = await board.command(0x02)
    check("and read back", s2[3] == 77)
    r = await board.command(0x03, bytes([0x01, brightness]))
    check(f"brightness restored to {brightness}", r[1] == OK)
    for key, name in ((0x04, "board type"), (0x10, "power supply"), (0x11, "headroom"), (0x12, "gamma")):
        r = await board.command(0x03, bytes([key, 1, 0]))
        check(f"{name} is read only", r[1] == ERROR and r[4] == 0x04, r.hex())
    r = await board.command(0x03, bytes([0x02, 0xFF, 0xFF]))
    check("chain length 65535 refused", r[1] == ERROR and r[4] == 0x03, r.hex())
    r = await board.command(0x42)
    check("unknown opcode refused", r[1] == ERROR and r[4] == 0x01, r.hex())

    print("Frames")
    # Colours Aurora API 3's 3-3-2 byte cannot carry exactly.
    colours = [(255, 128, 0), (0, 128, 128), (255, 105, 180), (75, 0, 130),
               (173, 255, 47), (255, 215, 0), (30, 144, 255), (220, 20, 60)]
    leds = [(i * 3, *colours[i]) for i in range(len(colours))]
    for p in frame_packets(1, leds):
        await board.write(p)
    r = await board.reply()
    check("one-packet frame shown", r[1] == SHOWN and r[2] == 1, r.hex())
    check("8 applied, 0 skipped, unscaled", le16(r, 3) == 8 and le16(r, 5) == 0 and r[7] == 255, r.hex())
    print(f"       LOOK: LEDs 0, 3, 6 ... 21 show orange, teal, pink, indigo, "
          f"green-yellow, gold, blue, crimson ({look:.0f} s)")
    await asyncio.sleep(look)

    leds = [(i, 0, 0, 255 - i) for i in range(chain)]
    packets = frame_packets(2, leds)
    for p in packets:
        await board.write(p)
    r = await board.reply()
    check(f"{len(packets)}-packet frame of {chain} LEDs shown once", r[1] == SHOWN and r[2] == 2
          and le16(r, 3) == chain, r.hex())
    print(f"       LOOK: the whole strip blue, fading slightly towards the end ({look:.0f} s)")
    await asyncio.sleep(look)

    for p in frame_packets(3, [(chain - 1, 0, 255, 0), (chain + 50, 255, 0, 0)]):
        await board.write(p)
    r = await board.reply()
    check("LED past the chain skipped and counted", le16(r, 3) == 1 and le16(r, 5) == 1, r.hex())

    await board.write(frame_packets(20, [(i, 50, 0, 0) for i in range(60)])[0])  # FIRST of two
    for p in frame_packets(21, [(0, 0, 50, 0)]):
        await board.write(p)
    a, b = await board.reply(), await board.reply()
    check("a new frame drops the unfinished one", a[1] == DROPPED and a[2] == 20 and a[3] == 0x01, a.hex())
    check("and shows itself", b[1] == SHOWN and b[2] == 21, b.hex())

    print("Aurora packets are not OpenBoard")
    aurora = pack(bytes([0x54, 0x00, 0x00, 0xE0]))  # API 3, LED 0 red
    await board.write(aurora)
    check("an Aurora frame gets no reply", await board.silence(0.8))

    await board.write(frame_packets(99, [])[0])
    r = await board.reply()
    check("an empty frame turns the strip off", r[1] == SHOWN and r[2] == 99 and le16(r, 3) == 0, r.hex())


async def wrong_id(board: Board):
    """A last packet carrying another frame's id abandons the frame."""
    first, _ = frame_packets(30, [(i, 0, 0, 50) for i in range(60)])
    stray = pack(bytes([LAST, 31, 0, 0, 0, 0, 50]))
    await board.write(first)
    await board.write(stray)
    r = await board.reply()
    check("a packet with another frame's id drops the frame", r[1] == DROPPED and r[2] == 30
          and r[3] == 0x02, r.hex())


def le16(b, i):
    return b[i] | (b[i + 1] << 8)


async def aurora_mode(board: Board):
    """A board in an Aurora-family mode must ignore OpenBoard API 1 entirely."""
    print("Aurora mode ignores OpenBoard API 1")
    await board.write(pack(bytes([COMMAND, 1, 0x01])))
    check("GET_INFO gets no reply", await board.silence(1.5))
    await board.write(frame_packets(1, [(0, 255, 0, 0)])[0])
    check("a frame gets no event", await board.silence(1.5))


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--address")
    ap.add_argument("--timeout", type=float, default=10.0)
    ap.add_argument("--look", type=float, default=4.0, help="seconds to hold frames worth seeing")
    ap.add_argument("--aurora-mode", action="store_true",
                    help="check a board in Kilter (or other Aurora) mode ignores OpenBoard API 1")
    args = ap.parse_args()

    address = args.address
    if not address:
        names = ({"Aurora Board#1@3", "Kilter Board#1@3", "Tension Board#1@3",
                  "Decoy Board#1@3", "Grasshopper Board#1@3"}
                 if args.aurora_mode else {"OpenBoard"})
        print(f"scanning {args.timeout:.0f}s for {' or '.join(sorted(names))}...", file=sys.stderr)
        dev = await BleakScanner.find_device_by_filter(lambda d, _ad: d.name in names,
                                                       timeout=args.timeout)
        if dev is None:
            sys.exit(f"no board advertising as {' or '.join(sorted(names))}; is it free?")
        address = dev.address

    async with BleakClient(address) as client:
        board = Board(client)
        await board.start()
        print(f"connected to {address}, mtu {client.mtu_size}\n")
        if args.aurora_mode:
            await aurora_mode(board)
        else:
            await run(board, args.look)
            await wrong_id(board)
            await board.write(frame_packets(100, [])[0])
            r = await board.reply()
            check("strip left dark", r[1] == SHOWN and le16(r, 3) == 0, r.hex())

    print(f"\n{'all checks passed' if failures == 0 else f'{failures} check(s) FAILED'}")
    sys.exit(1 if failures else 0)


asyncio.run(main())
