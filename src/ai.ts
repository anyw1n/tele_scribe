import OpenAI from 'openai';
import { Stream } from 'openai/core/streaming';
import { TranscriptionStreamEvent } from 'openai/resources/audio/transcriptions';
import { createReadStream } from 'fs';

export type { Stream, TranscriptionStreamEvent };

// TODO: Add enhancing, summary

/**
 * OpenAI client instance for AI operations
 */
const ai = new OpenAI();

/**
 * Transcribes an audio file using OpenAI
 * 
 * @param audioFilePath - Path to the audio file to transcribe
 * @returns A stream of transcription events
 * 
 * @example
 * ```typescript
 * const stream = await transcribe('/path/to/audio.ogg');
 * for await (const chunk of stream) {
 *   if (chunk.type === 'transcript.text.delta') {
 *     console.log(chunk.delta);
 *   }
 * }
 * ```
 */
export const transcribe = (audioFilePath: string) => ai.audio.transcriptions.create({
    model: 'gpt-4o-mini-transcribe',
    file: createReadStream(audioFilePath),
    language: 'ru',
    prompt: 'Привет, это эммм... промпт с пунктуацией. Бля, круто!',
    stream: true,
});
