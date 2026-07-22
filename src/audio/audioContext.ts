type AudioContextConstructor = new () => AudioContext;

let sharedAudioContext: AudioContext | undefined;

export function getSharedAudioContext(): AudioContext {
  if (sharedAudioContext) {
    return sharedAudioContext;
  }

  const audioGlobals = globalThis as typeof globalThis & {
    webkitAudioContext?: AudioContextConstructor;
  };
  const Constructor = globalThis.AudioContext ?? audioGlobals.webkitAudioContext;
  if (!Constructor) {
    throw new Error('Web Audio is not supported in this browser.');
  }

  sharedAudioContext = new Constructor();
  return sharedAudioContext;
}

export function unlockSharedAudioContext(
  context: AudioContext = getSharedAudioContext(),
): void {
  if (context.state !== 'suspended') {
    return;
  }

  try {
    void context.resume().catch(() => {});
  } catch {
    // Audio unlock is best effort and must not interrupt the user gesture.
  }
}
