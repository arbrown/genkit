/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { devLocalVectorstore } from '@genkit-ai/dev-local-vectorstore';
import { genkitEval, GenkitMetric } from '@genkit-ai/evaluator';
import { gemini15Flash, googleAI } from '@genkit-ai/googleai';
import { textEmbedding004, vertexAI } from '@genkit-ai/vertexai';
import {
  vertexAIEvaluation,
  VertexAIEvaluationMetricType,
} from '@genkit-ai/vertexai/evaluation';
import {
  claude35Sonnet,
  vertexAIModelGarden,
} from '@genkit-ai/vertexai/modelgarden';
import { genkit } from 'genkit';
import { logger } from 'genkit/logging';
import { chroma } from 'genkitx-chromadb';
import { ollama } from 'genkitx-ollama';
import { pinecone } from 'genkitx-pinecone';

logger.setLogLevel('info');

// Turn off safety checks for evaluation so that the LLM as an evaluator can
// respond appropriately to potentially harmful content without error.
export const PERMISSIVE_SAFETY_SETTINGS: any = {
  safetySettings: [
    {
      category: 'HARM_CATEGORY_HATE_SPEECH',
      threshold: 'BLOCK_NONE',
    },
    {
      category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
      threshold: 'BLOCK_NONE',
    },
    {
      category: 'HARM_CATEGORY_HARASSMENT',
      threshold: 'BLOCK_NONE',
    },
    {
      category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      threshold: 'BLOCK_NONE',
    },
  ],
};

export const ai = genkit({
  // load at least one plugin representing each action type
  plugins: [
    // model providers
    googleAI(),
    ollama({
      models: [
        { name: 'llama2' },
        { name: 'llama3' },
        {
          name: 'gemma',
          type: 'generate',
        },
      ],
      serverAddress: 'http://127.0.0.1:11434', // default local address
    }),
    vertexAI({
      location: 'us-central1',
    }),
    vertexAIModelGarden({
      location: 'us-central1',
      models: [claude35Sonnet],
    }),
    vertexAIEvaluation({
      location: 'us-central1',
      metrics: [
        VertexAIEvaluationMetricType.BLEU,
        VertexAIEvaluationMetricType.GROUNDEDNESS,
        VertexAIEvaluationMetricType.SAFETY,
        {
          type: VertexAIEvaluationMetricType.ROUGE,
          metricSpec: {
            rougeType: 'rougeLsum',
            useStemmer: true,
            splitSummaries: 'true',
          },
        },
      ],
    }),

    // vector stores
    chroma([
      {
        collectionName: 'chroma-collection',
        embedder: textEmbedding004,
        embedderOptions: { taskType: 'RETRIEVAL_DOCUMENT' },
      },
    ]),
    devLocalVectorstore([
      {
        indexName: 'naive-index',
        embedder: textEmbedding004,
        embedderOptions: { taskType: 'RETRIEVAL_DOCUMENT' },
      },
    ]),
    pinecone([
      {
        indexId: 'pinecone-index',
        embedder: textEmbedding004,
        embedderOptions: { taskType: 'RETRIEVAL_DOCUMENT' },
      },
    ]),

    // evaluation
    genkitEval({
      judge: gemini15Flash,
      judgeConfig: PERMISSIVE_SAFETY_SETTINGS,
      embedder: textEmbedding004,
      metrics: [
        GenkitMetric.ANSWER_RELEVANCY,
        GenkitMetric.FAITHFULNESS,
        GenkitMetric.MALICIOUSNESS,
      ],
    }),
  ],
});
