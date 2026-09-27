import { CommandError, CommandTimeout, pack, Session, unpack, type FrameEvent } from "../src/index.js";
import { hex } from "./helpers.js";

/** Records packets written, and plays the board's side through receive(). */
function fake(opts: { failWrites?: boolean } = {}) {
  const written: Uint8Array[] = [];
  const session = new Session(
    {
      write: async (p) => {
        if (opts.failWrites) throw new Error("write failed");
        written.push(p);
      },
    },
    1000,
  );
  /* The request id of the last command written. */
  const lastRequest = () => unpack(written[written.length - 1]!)[1]!;
  const reply = (payload: string) => session.receive(pack(hex(payload)));
  return { session, written, lastRequest, reply };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("Session", () => {
  it("matches a reply to its request", async () => {
    const f = fake();
    const info = f.session.getInfo();
    await tick();
    const id = f.lastRequest();
    f.reply(`B9 03 ${id.toString(16)} 01 01 01 00 E8 03 0F 00 06 32`);
    await expect(info).resolves.toMatchObject({ apiVersion: 1, boardType: "openboard", maxChainLength: 1000 });
  });

  it("numbers requests, and ignores replies to requests it did not make", async () => {
    const f = fake();
    const a = f.session.setBrightness(10);
    const b = f.session.setBrightness(20);
    await tick();
    const [ida, idb] = f.written.map((p) => unpack(p)[1]!);
    expect(idb).toBe(ida! + 1);

    f.reply("B9 01 C8"); /* nobody asked */
    f.reply(`B9 01 ${idb!.toString(16)}`);
    f.reply(`B9 01 ${ida!.toString(16)}`);
    await expect(Promise.all([a, b])).resolves.toEqual([undefined, undefined]);
  });

  it("turns ERROR into a CommandError naming the code", async () => {
    const f = fake();
    const set = f.session.setChainLength(9999);
    await tick();
    f.reply(`B9 02 ${f.lastRequest().toString(16)} 03 03`);
    await expect(set).rejects.toBeInstanceOf(CommandError);
    await expect(set).rejects.toMatchObject({ codeName: "outOfRange" });
  });

  it("times out when the board says nothing", async () => {
    vi.useFakeTimers();
    try {
      const f = fake();
      const info = f.session.getInfo();
      const caught = info.catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(1001);
      expect(await caught).toBeInstanceOf(CommandTimeout);
    } finally {
      vi.useRealTimers();
    }
  });

  it("numbers frames, wrapping at 255, and passes frame events on", async () => {
    const f = fake();
    const events: FrameEvent[] = [];
    f.session.onFrameEvent((e) => events.push(e));

    expect(await f.session.showFrame([{ pos: 0, r: 1, g: 2, b: 3 }])).toBe(0);
    expect(await f.session.showFrame([])).toBe(1);
    for (let i = 2; i < 256; i++) await f.session.showFrame([]);
    expect(await f.session.showFrame([])).toBe(0);

    f.reply("B9 10 01 00 00 00 00 FF");
    f.reply("B9 11 05 02");
    expect(events.map((e) => e.kind)).toEqual(["frameShown", "frameDropped"]);
  });

  it("writes a frame's packets together, in order, before the next write", async () => {
    const f = fake();
    const leds = Array.from({ length: 120 }, (_, i) => ({ pos: i, r: 0, g: 0, b: 9 }));
    const frame = f.session.showFrame(leds);
    const info = f.session.getInfo();
    await frame;
    await tick();
    expect(f.written.map((p) => p[4])).toEqual([0xb1, 0xb0, 0xb2, 0xb8]);
    f.session.close();
    await expect(info).rejects.toThrow(/disconnected/);
  });

  it("fails what is waiting when the link drops, and refuses new requests", async () => {
    const f = fake();
    const info = f.session.getInfo();
    await tick();
    f.session.close();
    await expect(info).rejects.toThrow(/disconnected/);
    await expect(f.session.getSettings()).rejects.toThrow(/disconnected/);
  });

  it("fails a request whose write fails", async () => {
    const f = fake({ failWrites: true });
    await expect(f.session.getInfo()).rejects.toThrow(/write failed/);
  });
});
