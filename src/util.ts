import { join } from 'path';
import { tmpdir } from 'os';
import { writeFile } from 'fs/promises';
import { Readable } from 'stream';
import { unlink } from 'fs';

/**
 * Download voice message from URL and save to a temporary file.
 * Returns the path to the downloaded file.
 * 
 * @param url - The URL to download the voice message from
 * @returns Promise that resolves to the path of the downloaded file
 * 
 * @example
 * ```typescript
 * const filePath = await downloadVoiceMessage('https://api.telegram.org/file/bot<token>/voice.ogg');
 * console.log('File downloaded to:', filePath);
 * ```
 * 
 * @throws {Error} When HTTP request fails or file writing fails
 */
export async function downloadVoiceMessage(url: string) {
    const startTime = Date.now();
    console.log('[downloadVoiceMessage] Starting download', { url });

    const fileName = `voice_${startTime}.ogg`;
    const filePath = join(tmpdir(), fileName);

    try {
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const stream = Readable.fromWeb(response.body!);
        await writeFile(filePath, stream);

        console.log('[downloadVoiceMessage] File downloaded to', { filePath });
        return filePath;
    } catch (error: any) {
        console.error('[downloadVoiceMessage] Error downloading file', {
            error: error.message,
            stack: error.stack,
        });
        throw error;
    } finally {
        const endTime = Date.now();
        const executionTime = endTime - startTime;
        console.log('[downloadVoiceMessage] Execution time, ms', { executionTime });
    }
}

/**
 * Deletes a file from the filesystem asynchronously
 * Logs success or failure
 * 
 * @param filePath - Path to the file to delete
 * 
 * @example
 * ```typescript
 * deleteFile('/tmp/voice_123.ogg');
 * // File will be deleted and result logged
 * ```
 */
export function deleteFile(filePath: string) {
    unlink(filePath, (error) => {
        if (error) {
            console.error(`[deleteFile] File not deleted`, { filePath, error });
        } else {
            console.log(`[deleteFile] File deleted`, { filePath });
        }
    });
}
