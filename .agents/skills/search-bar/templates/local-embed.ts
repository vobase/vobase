/**
 * Local embedding using Xenova/all-MiniLM-L6-v2 (384-dim, quantized ~23MB).
 * The pipeline is loaded lazily via dynamic import so a native-module failure
 * (e.g. onnxruntime-node incompatible with Bun) does NOT crash the server at
 * startup — embeddings simply become unavailable and keyword search is used instead.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pipe: any | null = null;
let _loading: Promise<any> | null = null;
let _unavailable = false;

export const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const EMBED_DIM = 384;

async function getPipeline(): Promise<any | null> {
  if (_unavailable) return null;
  if (_pipe) return _pipe;
  if (_loading) return _loading;
  try {
    // Dynamic import keeps the static import graph clean — native addon errors
    // are caught here instead of crashing the module at load time.
    const { pipeline } = await import('@xenova/transformers');
    _loading = pipeline('feature-extraction', EMBED_MODEL, { quantized: true });
    _pipe = await _loading;
    _loading = null;
    return _pipe;
  } catch (err) {
    console.warn('[local-embed] embedding model unavailable:', (err as Error).message ?? err);
    _unavailable = true;
    _loading = null;
    return null;
  }
}

/** Embed a single text string. Returns null if the model is unavailable. */
export async function embedText(text: string): Promise<Float32Array | null> {
  const pipe = await getPipeline();
  if (!pipe) return null;
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  return new Float32Array(output.data as ArrayLike<number>);
}

/** Pre-warm the model (call at server startup to avoid cold-start on first search). */
export async function warmupEmbedModel(): Promise<void> {
  await getPipeline();
}
