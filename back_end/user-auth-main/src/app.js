require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const errorHandler = require('./middlewares/error.handler');
const apiRoutes = require('./api'); // Main router for all API endpoints

const app = express();

// 3rd party Middleware
app.use(helmet());
// 10mb absorbs even chart-heavy thinking-mode runs (inline base64 PNGs
// in metadata.thinking.events) without hitting the body-parser-rejects-
// before-CORS path that surfaces in the browser as "Failed to fetch".
// B9's strip+proxy is the long-term fix; this is the bandaid until then.
app.use(express.json({ limit: '10mb' }));
app.use(cors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files
app.use('/uploads', express.static(path.join(__dirname, './uploads')));

// Template Engine Setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'templates'));

// Health check — used by orchestrator to know the service is ready.
app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', service: 'user-auth', timestamp: Date.now() });
});

// API Routes
app.use('/api/v1', apiRoutes);

// Global Error Handling Middleware
app.use(errorHandler);

module.exports = app;