const DEFAULT_EMBEDDING_MODEL = "gemini-embedding-001";
const DEFAULT_EMBED_BATCH_SIZE = 100;
const DEFAULT_EMBED_CONCURRENCY = 8;
const DEFAULT_EMBEDDING_DIMENSIONS = 768;

export type EmbeddingTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

function getEmbeddingModel(): string {
  return process.env.GEMINI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
}

function getEmbedBatchSize(): number {
  const parsed = Number(process.env.RAG_EMBED_BATCH_SIZE);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_EMBED_BATCH_SIZE;
}

function getEmbedConcurrency(): number {
  const parsed = Number(process.env.RAG_EMBED_CONCURRENCY);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_EMBED_CONCURRENCY;
}

function getEmbeddingDimensions(): number | undefined {
  const parsed = Number(process.env.RAG_EMBEDDING_DIMENSIONS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_EMBEDDING_DIMENSIONS;
}

async function batchEmbedContents(
  apiKey: string,
  texts: string[],
  taskType: EmbeddingTaskType,
  retryCount = 0
): Promise<number[][]> {
  const model = getEmbeddingModel();
  const dimensions = getEmbeddingDimensions();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      requests: texts.map((text) => ({
        model: `models/${model}`,
        content: { parts: [{ text }] },
        taskType,
        ...(dimensions ? { outputDimensionality: dimensions } : {}),
      })),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 429 && retryCount < 3) {
      await new Promise((resolve) => setTimeout(resolve, 2000 * (retryCount + 1)));
      return batchEmbedContents(apiKey, texts, taskType, retryCount + 1);
    }
    throw new Error(`Embedding API 오류 (${response.status}): ${body.slice(0, 300)}`);
  }

  const json = (await response.json()) as {
    embeddings?: Array<{ values?: number[] }>;
  };

  const embeddings = json.embeddings ?? [];
  return embeddings.map((item, index) => {
    const values = item.values;
    if (!values || values.length === 0) {
      throw new Error(`임베딩 결과가 비어 있습니다 (index ${index}).`);
    }
    return values;
  });
}

async function runBatchesWithConcurrency<T>(
  batches: Array<() => Promise<T>>,
  limit: number
): Promise<T[]> {
  const results: T[] = new Array(batches.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < batches.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await batches[index]();
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, batches.length) }, () => worker())
  );
  return results;
}

export async function embedTexts(
  texts: string[],
  taskType: EmbeddingTaskType = "RETRIEVAL_DOCUMENT",
  onBatchComplete?: (completed: number, total: number) => void
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");
  }

  const batchSize = getEmbedBatchSize();
  const concurrency = getEmbedConcurrency();
  const batches: string[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    batches.push(texts.slice(i, i + batchSize));
  }

  let completedBatches = 0;
  const batchTasks = batches.map(
    (batch) => async () => {
      const result = await batchEmbedContents(apiKey, batch, taskType);
      completedBatches += 1;
      onBatchComplete?.(completedBatches, batches.length);
      return result;
    }
  );
  const batchResults = await runBatchesWithConcurrency(batchTasks, concurrency);

  return batchResults.flat();
}

export async function embedQuery(text: string): Promise<number[]> {
  const [embedding] = await embedTexts([text], "RETRIEVAL_QUERY");
  return embedding;
}
