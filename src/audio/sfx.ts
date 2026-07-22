import { getSharedAudioContext } from './audioContext';

export type SfxName = 'announce' | 'correct' | 'wrong';

export interface SfxPlayer {
  preload(): Promise<void>;
  play(name: SfxName): void;
}

export interface SfxPlayerOptions {
  fetchClip?: (name: SfxName) => Promise<ArrayBuffer>;
  decode?: (buffer: ArrayBuffer) => Promise<AudioBuffer>;
  audioContext?: AudioContext;
}

const SFX_NAMES: readonly SfxName[] = ['announce', 'correct', 'wrong'];

function defaultFetchClip(name: SfxName): Promise<ArrayBuffer> {
  return fetch(`/sfx/${name}.mp3`).then((response) => response.arrayBuffer());
}

export function createSfxPlayer(options: SfxPlayerOptions = {}): SfxPlayer {
  const buffers = new Map<SfxName, AudioBuffer>();
  const pendingLoads = new Map<SfxName, Promise<void>>();
  let audioContext = options.audioContext;

  const getContext = (): AudioContext => {
    audioContext ??= getSharedAudioContext();
    return audioContext;
  };

  const fetchClip = options.fetchClip ?? defaultFetchClip;
  const decode = options.decode ?? ((buffer: ArrayBuffer) => getContext().decodeAudioData(buffer));

  const load = (name: SfxName): Promise<void> => {
    if (buffers.has(name)) {
      return Promise.resolve();
    }

    const pending = pendingLoads.get(name);
    if (pending) {
      return pending;
    }

    const request = Promise.resolve()
      .then(() => fetchClip(name))
      .then((buffer) => decode(buffer))
      .then((decoded) => {
        buffers.set(name, decoded);
      })
      .finally(() => {
        pendingLoads.delete(name);
      });
    pendingLoads.set(name, request);
    return request;
  };

  const playBuffer = (buffer: AudioBuffer): void => {
    const context = getContext();
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start(0);
  };

  const play = (name: SfxName): void => {
    try {
      const buffer = buffers.get(name);
      if (buffer) {
        playBuffer(buffer);
        return;
      }

      void load(name)
        .then(() => {
          const loaded = buffers.get(name);
          if (!loaded) return;
          try {
            playBuffer(loaded);
          } catch {
            // SFX playback is best effort and must not stop the game.
          }
        })
        .catch(() => {
          // SFX loading is best effort and must not stop the game.
        });
    } catch {
      // SFX playback is best effort and must not stop the game.
    }
  };

  return {
    preload(): Promise<void> {
      return Promise.all(SFX_NAMES.map((name) => load(name))).then(() => undefined);
    },
    play,
  };
}

export const sfx: SfxPlayer = createSfxPlayer();
