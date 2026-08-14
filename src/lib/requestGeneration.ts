export interface RequestGeneration {
  capture: () => () => boolean;
  invalidate: () => void;
}

export function createRequestGeneration(): RequestGeneration {
  let generation = 0;

  return {
    capture: () => {
      const capturedGeneration = generation;
      return () => capturedGeneration === generation;
    },
    invalidate: () => {
      generation += 1;
    },
  };
}
