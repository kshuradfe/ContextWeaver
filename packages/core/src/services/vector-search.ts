const JINA_API_KEY = process.env.JINA_API_KEY ?? '';
const JINA_EMBED_URL = 'https://api.jina.ai/v1/embeddings';

export const EMBEDDING_MODEL = 'jina-embed-text-v3';
export const EMBEDDING_DIM = 1024;

export class VectorService {
  /**
   * Generate embedding via Jina AI API
   * Uses text-embedding-3-small (1024 dim)
   */
  static async embed(text: string): Promise<Float32Array> {
    const truncated = text.slice(0, 8000); // Safety limit

    const response = await fetch(JINA_EMBED_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${JINA_API_KEY}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: truncated,
        dimensions: EMBEDDING_DIM,
        encoding_format: 'float',
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Jina API error ${response.status}: ${text}`);
    }

    const data = (await response.json()) as { data: { embedding: number[] }[] };

    if (!data.data?.[0]?.embedding) {
      throw new Error('Jina API returned no embedding');
    }

    return new Float32Array(data.data[0].embedding);
  }
}
