import {
  createSegmentPlayer,
  crossfadeConcat,
  resolveSeekMs,
  type PcmBuffer,
} from '../../src/audio/segmentPlayer';

const SAMPLE_RATE = 1_000;

function decodedBuffer(values: number[]): AudioBuffer {
  const channel = new Float32Array(values);
  return {
    duration: channel.length / SAMPLE_RATE,
    length: channel.length,
    numberOfChannels: 1,
    sampleRate: SAMPLE_RATE,
    getChannelData: () => channel,
  } as unknown as AudioBuffer;
}

function pcm(values: number[]): PcmBuffer {
  return { channels: [new Float32Array(values)], sampleRate: SAMPLE_RATE };
}

function makeAudioContext(): AudioContext {
  const destination = {} as AudioDestinationNode;
  const context = {
    currentTime: 0,
    destination,
    state: 'running',
    createBuffer: vi.fn((channels: number, length: number, sampleRate: number) => {
      const channelData = Array.from(
        { length: channels },
        () => new Float32Array(length),
      );
      return {
        duration: length / sampleRate,
        length,
        numberOfChannels: channels,
        sampleRate,
        getChannelData: (index: number) => channelData[index],
      } as unknown as AudioBuffer;
    }),
    createBufferSource: vi.fn(() => {
      const source = {
        buffer: null as AudioBuffer | null,
        onended: null as (() => void) | null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      return source as unknown as AudioBufferSourceNode;
    }),
    resume: vi.fn(async () => undefined),
  };
  return context as unknown as AudioContext;
}

describe('segment audio PCM helpers', () => {
  it('uses an equal-power crossfade at the segment boundary', () => {
    const merged = crossfadeConcat(pcm([1, 1, 1, 1]), pcm([0, 0, 0, 0]), 2);
    const samples = merged.channels[0];

    expect(Array.from(samples)).toEqual([
      1,
      1,
      expect.closeTo(Math.cos(Math.PI / 4), 5),
      expect.closeTo(0, 5),
      0,
      0,
    ]);
  });

  it('clamps seek positions to the fetched range', () => {
    expect(resolveSeekMs(-100, 5_000)).toBe(0);
    expect(resolveSeekMs(7_000, 5_000)).toBe(5_000);
    expect(resolveSeekMs(2_000, 5_000)).toBe(2_000);
  });
});

describe('segment player', () => {
  it('crossfades two five-second segments and reports the merged duration', async () => {
    const context = makeAudioContext();
    const decode = vi
      .fn<(buffer: ArrayBuffer) => Promise<AudioBuffer>>()
      .mockResolvedValueOnce(decodedBuffer(new Array(5_000).fill(1)))
      .mockResolvedValueOnce(decodedBuffer(new Array(5_000).fill(0)));
    const player = createSegmentPlayer({
      decode,
      fetchSegment: vi.fn(),
      audioContext: context,
    });

    await player.appendSegment(0, new ArrayBuffer(1));
    await player.appendSegment(1, new ArrayBuffer(1));

    expect(player.getFetchedMs()).toBeCloseTo(9_975, 5);
    expect(player.getDurationMs()).toBeCloseTo(9_975, 5);
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it('does not expose a seek position past the fetched range', async () => {
    const player = createSegmentPlayer({
      decode: vi.fn().mockResolvedValue(decodedBuffer(new Array(5_000).fill(0))),
      fetchSegment: vi.fn(),
      audioContext: makeAudioContext(),
    });

    await player.appendSegment(0, new ArrayBuffer(1));
    player.seek(8_000);
    expect(player.getPositionMs()).toBe(5_000);

    player.seek(-100);
    expect(player.getPositionMs()).toBe(0);
  });

  it('jumps five seconds from the current position and clamps at the end', async () => {
    const player = createSegmentPlayer({
      decode: vi.fn().mockResolvedValue(decodedBuffer(new Array(10_000).fill(0))),
      fetchSegment: vi.fn(),
      audioContext: makeAudioContext(),
    });

    await player.appendSegment(0, new ArrayBuffer(1));
    player.seek(1_000);
    player.jumpBy(5_000);
    expect(player.getPositionMs()).toBe(6_000);

    player.jumpBy(5_000);
    expect(player.getPositionMs()).toBe(10_000);
  });
});
