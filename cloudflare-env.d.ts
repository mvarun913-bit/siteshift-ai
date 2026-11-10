interface CloudflareEnv {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  ANTHROPIC_API_KEY: string;
  CLAUDE_MODEL?: string;
  ASK_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
}
