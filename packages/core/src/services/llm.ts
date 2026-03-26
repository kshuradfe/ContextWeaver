import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.MINIMAX_API_KEY ?? '',
  baseURL: 'https://api.minimaxi.com/v1', // MiniMax-compatible endpoint
});

const LLM_MODEL = 'MiniMax-M2.7';

export class LLMService {
  /**
   * Generate a one-sentence summary of card content using MiniMax M2.7
   * Failures are non-blocking — returns null, never throws
   */
  static async summarize(content: string): Promise<string | null> {
    try {
      // Truncate if too long (8192 token limit safety)
      const truncated = content.slice(0, 8000);

      const response = await anthropic.messages.create({
        model: LLM_MODEL,
        max_tokens: 100,
        messages: [
          {
            role: 'user',
            content: `Summarize this in one concise sentence:\n\n${truncated}`,
          },
        ],
      });

      return response.content[0].type === 'text' ? response.content[0].text.trim() : null;
    } catch (err) {
      console.error('[LLM] Summary failed:', err);
      return null; // Non-blocking — summary is nullable
    }
  }
}
