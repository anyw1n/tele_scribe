import dotenv from 'dotenv';
dotenv.config({ path: `.env.${process.env['NODE_ENV']}` });

import express from 'express';
import { createWebhook } from './bot';

const { PORT: port } = process.env;

/**
 * Main application entry point
 * Sets up Express server with Telegram webhook integration
 */
(async () => {
    const app = express();
    app.use(express.json(), await createWebhook());
    app.listen(port, () => console.log(`Server listening on port ${port}...`));
})();
