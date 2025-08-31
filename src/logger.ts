import { File, Update } from 'grammy/types'

export { serverLogger, aiLogger, utilLogger, botLogger };

abstract class LogFlow {
    abstract readonly tag: string;

    private tagged = (message: string) => `[${this.tag}] ${message}`;

    protected log = (message: string, ...optionalParams: any[]) =>
        console.log(this.tagged(message), ...optionalParams);

    protected logError = (message: string, ...optionalParams: any[]) =>
        console.error(this.tagged(message), ...optionalParams);
}

abstract class MeasurableLogFlow extends LogFlow {
    readonly startTime = Date.now();

    get executionTime() {
        return Date.now() - this.startTime;
    }
}

class ServerLogger {
    startServer = (port: string) => new ServerLogFlow(port);
}
const serverLogger = new ServerLogger();

class ServerLogFlow extends LogFlow {
    override tag = 'SERVER';

    constructor(port: string) {
        super();
        this.log(`Start listening on port ${port}...`);
    }
}

class AiLogger {
    startAudioTranscription = (filePath: string) => new AiTranscribeLogFlow(filePath);
}
const aiLogger = new AiLogger();

class AiTranscribeLogFlow extends MeasurableLogFlow {
    override tag = 'AI';

    constructor(filePath: string) {
        super();
        this.log('Start audio transcribing', { filePath });
    }

    error = (error: any) =>
        this.logError('Error transcribing audio', { error, executionTime: this.executionTime });

    audioTranscribed = (result: any) =>
        this.log('Audio transcribed', { result, executionTime: this.executionTime });
}

class UtilLogger {
    startDownload = (url: string) => new DownloadFileLogFlow(url);

    startFileDeleting = (filePath: string) => new DeleteFileLogFlow(filePath);

    startAudioExtracting = (filePath: string) => new AudioExtractingLogFlow(filePath);
}
const utilLogger = new UtilLogger();

class DownloadFileLogFlow extends MeasurableLogFlow {
    override tag = 'DOWNLOAD';

    constructor(url: string) {
        super();
        this.log('Start download', { url });
    }

    error = (error: any) =>
        this.logError('Error downloading file', { error, executionTime: this.executionTime });

    downloaded = (filePath: string) =>
        this.log('File downloaded', { filePath, executionTime: this.executionTime });
}

class DeleteFileLogFlow extends LogFlow {
    override tag = 'DELELE_FILE';

    filePath: string;

    constructor(filePath: string) {
        super();
        this.filePath = filePath;
        this.log('Start file deleting', { filePath });
    }

    error = (error: any) =>
        this.logError('Error deleting file', { filePath: this.filePath, error });

    deleted = () => this.log('File deleted', { filePath: this.filePath });
}

class AudioExtractingLogFlow extends MeasurableLogFlow {
    override tag = 'AUDIO_EXTRACTION';

    constructor(filePath: string) {
        super();
        this.log('Start audio extraction', { filePath });
    }

    error = (error: any) =>
        this.logError('Audio extraction failed', { error, executionTime: this.executionTime });

    extracted = (outputPath: string) =>
        this.log('Audio extraction completed', { outputPath, executionTime: this.executionTime });
}

class BotLogger {
    startWebhookCreating = (domain: string) => new WebhookCreatingLogFlow(domain);

    messageReceived = (update: Update) => new MessageReceivedLogFlow(update);

    startMediaProcessing = () => new MediaProcessingLogFlow();
}
const botLogger = new BotLogger();

class WebhookCreatingLogFlow extends LogFlow {
    override tag = 'WEBHOOK';

    constructor(domain: string) {
        super();
        this.log('Creating webhook with domain', { domain });
    }

    error = (error: any) => this.logError('Failed to create webhook', { error });

    created = () => this.log('Webhook created successfully');
}

class MessageReceivedLogFlow extends MeasurableLogFlow {
    override tag = 'BOT';

    constructor(update: Update) {
        super();
        this.log('Message received', { update });
    }

    completed = () =>
        this.log('Message processing completed', { executionTime: this.executionTime });
}

class MediaProcessingLogFlow extends MeasurableLogFlow {
    override tag = 'MEDIA_PROCESS';

    constructor() {
        super();
        this.log('Start media processing');
    }

    fileInfoReceived = (file: File) => this.log('File info received:', { file });

    error = (error: any) =>
        this.logError('Error media processing', { error, executionTime: this.executionTime });

    completed = () =>
        this.log('Media processing completed', { executionTime: this.executionTime });
}
