const DEFAULT_OVERLAP_MS = 25;

export interface PcmBuffer {
  channels: Float32Array[];
  sampleRate: number;
}

export type DecodeAudioData = (buffer: ArrayBuffer) => Promise<AudioBuffer>;
export type FetchSegment = (segment: number) => Promise<ArrayBuffer>;

export interface SegmentPlayerOptions {
  decode?: DecodeAudioData;
  fetchSegment?: FetchSegment;
  audioContext?: AudioContext;
  overlapMs?: number;
}

export interface SegmentPlayer {
  appendSegment(segment: number, buffer: ArrayBuffer): Promise<void>;
  loadSegment(segment: number): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seek(milliseconds: number): void;
  jumpBy(milliseconds: number): void;
  getFetchedMs(): number;
  getPositionMs(): number;
  getDurationMs(): number;
}

function copyChannel(channel: Float32Array): Float32Array {
  return new Float32Array(channel);
}

function clonePcmBuffer(buffer: PcmBuffer): PcmBuffer {
  return {
    channels: buffer.channels.map(copyChannel),
    sampleRate: buffer.sampleRate,
  };
}

function normalizeOverlapSamples(overlapSamples: number | undefined): number {
  if (overlapSamples === undefined || !Number.isFinite(overlapSamples)) {
    return 0;
  }
  return Math.max(0, Math.floor(overlapSamples));
}

function assertCompatiblePcm(first: PcmBuffer, second: PcmBuffer): void {
  if (first.sampleRate !== second.sampleRate) {
    throw new Error('Cannot concatenate audio with different sample rates.');
  }
  if (first.channels.length !== second.channels.length) {
    throw new Error('Cannot concatenate audio with different channel counts.');
  }
  for (const channel of first.channels) {
    if (channel.length !== first.channels[0]?.length) {
      throw new Error('PCM channels must have equal lengths.');
    }
  }
  for (const channel of second.channels) {
    if (channel.length !== second.channels[0]?.length) {
      throw new Error('PCM channels must have equal lengths.');
    }
  }
}

function concatTwoPcm(
  first: PcmBuffer,
  second: PcmBuffer,
  overlapSamples: number,
): PcmBuffer {
  assertCompatiblePcm(first, second);

  const overlap = Math.min(overlapSamples, first.channels[0]?.length ?? 0, second.channels[0]?.length ?? 0);
  const firstLength = first.channels[0]?.length ?? 0;
  const secondLength = second.channels[0]?.length ?? 0;
  const outputLength = firstLength + secondLength - overlap;

  const channels = first.channels.map((firstChannel, channelIndex) => {
    const secondChannel = second.channels[channelIndex];
    const output = new Float32Array(outputLength);

    output.set(firstChannel.subarray(0, firstLength - overlap));

    if (overlap === 0) {
      output.set(secondChannel, firstLength);
      return output;
    }

    for (let index = 0; index < overlap; index += 1) {
      // Cosine and sine gains preserve constant power through the overlap.
      const phase = ((index + 1) / overlap) * (Math.PI / 2);
      const firstGain = Math.cos(phase);
      const secondGain = Math.sin(phase);
      output[firstLength - overlap + index] =
        firstChannel[firstLength - overlap + index] * firstGain +
        secondChannel[index] * secondGain;
    }

    output.set(secondChannel.subarray(overlap), firstLength);
    return output;
  });

  return { channels, sampleRate: first.sampleRate };
}

/**
 * Concatenate PCM chunks with an equal-power overlap.
 *
 * The overload accepting two buffers is convenient for callers joining one
 * newly decoded segment. The array form is used by the player when rebuilding
 * the contiguous range after an out-of-order append.
 */
export function crossfadeConcat(
  buffers: readonly PcmBuffer[],
  overlapSamples?: number,
): PcmBuffer;
export function crossfadeConcat(
  first: PcmBuffer,
  second: PcmBuffer,
  overlapSamples?: number,
): PcmBuffer;
export function crossfadeConcat(
  firstOrBuffers: PcmBuffer | readonly PcmBuffer[],
  secondOrOverlap?: PcmBuffer | number,
  explicitOverlapSamples?: number,
): PcmBuffer {
  const buffers = Array.isArray(firstOrBuffers)
    ? firstOrBuffers
    : [firstOrBuffers, secondOrOverlap as PcmBuffer];
  const overlapSamples = Array.isArray(firstOrBuffers)
    ? normalizeOverlapSamples(secondOrOverlap as number | undefined)
    : normalizeOverlapSamples(explicitOverlapSamples);

  if (buffers.length === 0) {
    return { channels: [], sampleRate: 0 };
  }
  if (buffers.length === 1) {
    return clonePcmBuffer(buffers[0]);
  }

  return buffers.slice(1).reduce(
    (merged, buffer) => concatTwoPcm(merged, buffer, overlapSamples),
    clonePcmBuffer(buffers[0]),
  );
}

/** Clamp a requested position to the portion of audio already fetched. */
export function resolveSeekMs(requestedMs: number, fetchedMs: number): number {
  const upperBound = Number.isFinite(fetchedMs) ? Math.max(0, fetchedMs) : 0;
  const requested = Number.isFinite(requestedMs) ? requestedMs : 0;
  return Math.min(Math.max(0, requested), upperBound);
}

function toPcmBuffer(buffer: AudioBuffer): PcmBuffer {
  return {
    channels: Array.from({ length: buffer.numberOfChannels }, (_, index) =>
      copyChannel(buffer.getChannelData(index)),
    ),
    sampleRate: buffer.sampleRate,
  };
}

function toAudioBuffer(buffer: PcmBuffer, context: AudioContext): AudioBuffer {
  if (buffer.channels.length === 0) {
    throw new Error('Cannot play an empty audio buffer.');
  }

  const length = buffer.channels[0].length;
  const audioBuffer = context.createBuffer(
    buffer.channels.length,
    length,
    buffer.sampleRate,
  );
  buffer.channels.forEach((channel, index) => {
    audioBuffer.getChannelData(index).set(channel);
  });
  return audioBuffer;
}

type AudioContextConstructor = new () => AudioContext;

function getDefaultAudioContext(): AudioContext {
  const audioGlobals = globalThis as typeof globalThis & {
    webkitAudioContext?: AudioContextConstructor;
  };
  const Constructor = globalThis.AudioContext ?? audioGlobals.webkitAudioContext;
  if (!Constructor) {
    throw new Error('Web Audio is not supported in this browser.');
  }
  return new Constructor();
}

export function createSegmentPlayer(
  options: SegmentPlayerOptions = {},
): SegmentPlayer {
  const context = options.audioContext;
  let audioContext = context;
  const overlapMs = options.overlapMs ?? DEFAULT_OVERLAP_MS;
  const decodedSegments = new Map<number, PcmBuffer>();
  const pendingLoads = new Map<number, Promise<void>>();

  let merged: PcmBuffer | null = null;
  let positionMs = 0;
  let source: AudioBufferSourceNode | null = null;
  let playing = false;
  let startedAtContextTime = 0;
  let startedAtPositionMs = 0;
  let playbackToken = 0;

  const getContext = (): AudioContext => {
    audioContext ??= getDefaultAudioContext();
    return audioContext;
  };

  const decode: DecodeAudioData =
    options.decode ?? ((buffer) => getContext().decodeAudioData(buffer));

  const getDurationMs = (): number => {
    if (!merged || merged.sampleRate <= 0 || merged.channels.length === 0) {
      return 0;
    }
    return (merged.channels[0].length / merged.sampleRate) * 1000;
  };

  const getCurrentPositionMs = (): number => {
    if (!playing || !audioContext) {
      return resolveSeekMs(positionMs, getDurationMs());
    }

    const elapsedMs = Math.max(
      0,
      (audioContext.currentTime - startedAtContextTime) * 1000,
    );
    return resolveSeekMs(startedAtPositionMs + elapsedMs, getDurationMs());
  };

  const stopSource = (): void => {
    playbackToken += 1;
    playing = false;
    const currentSource = source;
    source = null;
    if (!currentSource) return;
    currentSource.onended = null;
    try {
      currentSource.stop();
    } catch {
      // A source may already have ended; stopping it is then harmless.
    }
    try {
      currentSource.disconnect();
    } catch {
      // Some minimal test doubles do not implement disconnect.
    }
  };

  const startSource = (): void => {
    if (!merged) return;

    const durationMs = getDurationMs();
    if (durationMs <= 0) return;

    const contextForPlayback = getContext();
    const audioBuffer = toAudioBuffer(merged, contextForPlayback);
    const nextSource = contextForPlayback.createBufferSource();
    nextSource.buffer = audioBuffer;
    nextSource.connect(contextForPlayback.destination);

    const token = ++playbackToken;
    const startPositionMs = resolveSeekMs(positionMs, durationMs);
    startedAtPositionMs = startPositionMs;
    startedAtContextTime = contextForPlayback.currentTime;
    source = nextSource;
    playing = true;

    nextSource.onended = () => {
      if (token !== playbackToken || source !== nextSource) return;
      source = null;
      playing = false;
      positionMs = durationMs;
    };
    nextSource.start(0, startPositionMs / 1000);
  };

  const restartSource = (nextPositionMs: number): void => {
    stopSource();
    positionMs = resolveSeekMs(nextPositionMs, getDurationMs());
    startSource();
  };

  const rebuildMerged = (): void => {
    const contiguous: PcmBuffer[] = [];
    for (let segment = 0; decodedSegments.has(segment); segment += 1) {
      contiguous.push(decodedSegments.get(segment)!);
    }

    if (contiguous.length === 0) {
      merged = null;
      return;
    }

    const sampleRate = contiguous[0].sampleRate;
    const overlapSamples = Math.round((sampleRate * overlapMs) / 1000);
    merged = crossfadeConcat(contiguous, overlapSamples);
  };

  const appendSegment = async (
    segment: number,
    buffer: ArrayBuffer,
  ): Promise<void> => {
    if (!Number.isInteger(segment) || segment < 0) {
      throw new RangeError('Segment index must be a non-negative integer.');
    }

    const wasPlaying = playing;
    const decoded = toPcmBuffer(await decode(buffer));
    const previousPositionMs = getCurrentPositionMs();
    decodedSegments.set(segment, decoded);
    rebuildMerged();

    positionMs = resolveSeekMs(previousPositionMs, getDurationMs());
    if (wasPlaying) {
      restartSource(positionMs);
    }
  };

  const loadSegment = async (segment: number): Promise<void> => {
    if (!options.fetchSegment) {
      throw new Error('No fetchSegment function was provided.');
    }
    const existing = pendingLoads.get(segment);
    if (existing) return existing;

    const load = options.fetchSegment(segment)
      .then((buffer) => appendSegment(segment, buffer))
      .finally(() => pendingLoads.delete(segment));
    pendingLoads.set(segment, load);
    return load;
  };

  return {
    appendSegment,
    loadSegment,
    async play(): Promise<void> {
      if (playing || getDurationMs() <= 0) return;

      const contextForPlayback = getContext();
      if (contextForPlayback.state === 'suspended') {
        await contextForPlayback.resume();
      }
      if (playing) return;

      if (positionMs >= getDurationMs()) {
        positionMs = 0;
      }
      startSource();
    },
    pause(): void {
      if (!playing) return;
      positionMs = getCurrentPositionMs();
      playing = false;
      stopSource();
    },
    seek(milliseconds: number): void {
      const wasPlaying = playing;
      const nextPositionMs = resolveSeekMs(milliseconds, getDurationMs());
      positionMs = nextPositionMs;
      if (wasPlaying) {
        restartSource(nextPositionMs);
      }
    },
    jumpBy(milliseconds: number): void {
      const nextPositionMs = getCurrentPositionMs() + milliseconds;
      const wasPlaying = playing;
      positionMs = resolveSeekMs(nextPositionMs, getDurationMs());
      if (wasPlaying) {
        restartSource(positionMs);
      }
    },
    getFetchedMs: getDurationMs,
    getPositionMs: getCurrentPositionMs,
    getDurationMs,
  };
}
