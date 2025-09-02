import OpenAI from 'openai';
import { AudioModel } from 'openai/resources/index';

import { createReadStream, existsSync } from 'fs';
import { readFile } from 'fs/promises';

import { aiLogger as logger } from './logger';

/**
 * OpenAI client instance for AI operations
 */
const ai = new OpenAI({ logLevel: 'info' });

/**
 * Transcribes audio files using OpenAI's Whisper model
 * 
 * @param audioFilePath - Path to the audio file to transcribe
 * @param signal - An AbortSignal that can be used to cancel the request
 * @returns Promise that resolves to the transcribed text
 * 
 * @example
 * ```typescript
 * const text = await transcribe('/tmp/voice_message.ogg', abortController.signal);
 * console.log('Transcribed text:', text);
 * ```
 * 
 * @throws {Error} When OpenAI API request fails or file cannot be read
 * @throws {AbortError} When the request is cancelled via AbortSignal
 */
export async function transcribe(
    audioFilePath: string,
    signal: AbortSignal,
    model: AudioModel = 'whisper-1',
) {
    const dict = existsSync('dict.txt') ? await readFile('dict.txt', 'utf-8') : '';
    const log = logger.startAudioTranscription(audioFilePath, model, dict);

    try {
        const tr = await ai.audio.transcriptions.create({
            model,
            file: createReadStream(audioFilePath),
            language: 'ru',
            prompt: `${dict === '' ? '' : `Убедись, что следующие слова написаны правильно: ${dict}. `} 
Расставь необходимые знаки препинания в предложениях.`,
        }, { signal });

        log.audioTranscribed(tr);
        return tr.text;
    } catch (error: any) {
        log.error(error);
        throw error;
    }
}
