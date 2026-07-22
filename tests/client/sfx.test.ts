import {
  getSharedAudioContext,
  unlockSharedAudioContext,
} from '../../src/audio/audioContext';
import { createSfxPlayer } from '../../src/audio/sfx';

function makeAudioContext(state: AudioContextState = 'running'): AudioContext {
  const context = {
    createBufferSource: vi.fn(() => ({
      connect: vi.fn(),
      start: vi.fn(),
    })),
    destination: {},
    resume: vi.fn(() => Promise.resolve()),
    state,
  };
  return context as unknown as AudioContext;
}

describe('shared audio context', () => {
  it('returns the same lazily-created context', () => {
    const AudioContextConstructor = vi.fn(() => makeAudioContext());
    const globals = globalThis as typeof globalThis & {
      AudioContext?: typeof AudioContext;
    };
    const previousConstructor = globals.AudioContext;
    globals.AudioContext = AudioContextConstructor as unknown as typeof AudioContext;

    try {
      const first = getSharedAudioContext();
      const second = getSharedAudioContext();

      expect(first).toBe(second);
      expect(AudioContextConstructor).toHaveBeenCalledTimes(1);
    } finally {
      globals.AudioContext = previousConstructor;
    }
  });

  it('resumes a suspended context without waiting for the promise', () => {
    const context = makeAudioContext('suspended');

    expect(() => unlockSharedAudioContext(context)).not.toThrow();
    expect(context.resume).toHaveBeenCalledTimes(1);
  });
});

describe('SFX player', () => {
  it('deduplicates concurrent preload fetches and decodes', async () => {
    const fetchClip = vi.fn(async (name: 'announce' | 'correct' | 'wrong') =>
      new TextEncoder().encode(name).buffer,
    );
    const decode = vi.fn(async (buffer: ArrayBuffer) => ({ buffer }) as unknown as AudioBuffer);
    const player = createSfxPlayer({
      fetchClip,
      decode,
      audioContext: makeAudioContext(),
    });

    await Promise.all([player.preload(), player.preload()]);

    expect(fetchClip).toHaveBeenCalledTimes(3);
    expect(decode).toHaveBeenCalledTimes(3);
    expect(fetchClip.mock.calls.map(([name]) => name).sort()).toEqual([
      'announce',
      'correct',
      'wrong',
    ]);
  });

  it('loads and plays a clip when play is called before preload', async () => {
    const context = makeAudioContext();
    const player = createSfxPlayer({
      fetchClip: vi.fn(async () => new ArrayBuffer(1)),
      decode: vi.fn(async () => ({} as AudioBuffer)),
      audioContext: context,
    });

    player.play('correct');
    await vi.waitFor(() => {
      expect(context.createBufferSource).toHaveBeenCalledTimes(1);
    });
  });

  it('does not throw synchronously when decoding fails', () => {
    const player = createSfxPlayer({
      fetchClip: vi.fn(async () => new ArrayBuffer(1)),
      decode: vi.fn(async () => {
        throw new Error('decode failed');
      }),
      audioContext: makeAudioContext(),
    });

    expect(() => player.play('wrong')).not.toThrow();
  });

  it('can be constructed without browser audio APIs', () => {
    expect(() => createSfxPlayer()).not.toThrow();
  });
});
