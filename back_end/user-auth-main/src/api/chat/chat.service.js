// src/api/chat/chat.service.js
const dfw = require('../../utils/dataframe-wrapper');
const FileRepository = require('../file/file.repository');
const ProcessRepository = require('../process/process.repository');

class ChatService {
    constructor() {
        this.fileRepository = FileRepository;
        this.processRepository = ProcessRepository;
        this.csvReadOptions = {
            header: true,
            delimiter: ",",
            skipEmptyLines: true,
            encoding: "utf8",
            dynamicTyping: true,
        };
    }

    /**
     * Process a chat message and return structured response
     */
    async processMessage(message, fileId, userId) {
        const result = {
            reply: "",
            chartSpecs: [],
            insights: [],
            tablePreview: null
        };

        // If no file selected, return helpful message
        if (!fileId) {
            result.reply = "Please import a dataset first using the 'Import Excel' button. Once you have data loaded, I can help you:\n\n• Visualize trends and patterns\n• Find anomalies in your data\n• Generate summary statistics\n• Create various chart types";
            return result;
        }

        // Verify file access
        const file = await this.fileRepository.findByIdAndUserId(fileId, userId);
        if (!file) {
            result.reply = "I couldn't find that dataset. Please try importing it again.";
            return result;
        }

        // Get or create analysis
        let analysis = await this.processRepository.findByFileId(fileId);
        if (!analysis) {
            // Perform analysis
            const df = await dfw.readCSV(file.storagePath, this.csvReadOptions);
            const analysisData = {
                fileId,
                metadata: df.getMetadata(),
                missingValues: df.getMissingValues(),
                summaryStatistics: df.getSummaryStatistics(),
                uniqueValues: df.getUniqueValues(),
                status: 'COMPLETED'
            };
            analysis = await this.processRepository.createOrUpdate(fileId, analysisData);
        }

        // Parse user intent from message
        const intent = this.parseIntent(message.toLowerCase());

        // Generate response based on intent
        switch (intent.type) {
            case 'summarize':
                result.reply = this.generateSummary(file, analysis);
                result.insights = this.generateInsights(analysis);
                break;

            case 'chart':
                result.reply = this.generateChartResponse(file, analysis, intent.chartType);
                result.chartSpecs = this.generateChartSpecs(analysis, intent.chartType);
                break;

            case 'anomalies':
                result.reply = this.generateAnomalyResponse(analysis);
                result.insights = this.generateAnomalyInsights(analysis);
                break;

            case 'trends':
                result.reply = this.generateTrendResponse(file, analysis);
                result.chartSpecs = this.generateTrendCharts(analysis);
                break;

            default:
                result.reply = this.generateGeneralResponse(file, analysis);
                result.insights = this.generateInsights(analysis);
        }

        return result;
    }

    /**
     * Get file preview (parsed rows/columns)
     */
    async getFilePreview(fileId, userId, limit = 100) {
        const file = await this.fileRepository.findByIdAndUserId(fileId, userId);
        if (!file) {
            throw { statusCode: 404, message: "File not found" };
        }

        const df = await dfw.readCSV(file.storagePath, this.csvReadOptions);
        const rows = df.head(limit).values;
        const columns = df.columns;

        return {
            fileName: file.originalFilename,
            columns,
            rows,
            totalRows: df.shape[0],
            totalColumns: df.shape[1]
        };
    }

    /**
     * Get preview for lakehouse-stored data (MinIO)
     * Fetches data from datalakehouse service instead of local files
     * Note: We skip job lookup since job data is ephemeral (Redis).
     * After upload completes, the Iceberg table exists permanently.
     */
    async getLakehousePreview(jobId, projectId, tableName, limit = 50, authToken = '') {
        // The "lakehouse" name is historical — we now hit the in-process
        // DuckDB engine exposed by Chart-API at /api/v1/schema and /api/v1/query.
        const engineUrl = process.env.DATA_ENGINE_URL
            || process.env.LAKEHOUSE_URL
            || 'http://localhost:8000/api/v1';
        const headers = authToken ? { 'x-auth-token': authToken } : {};

        try {
            console.log(`[Preview] Querying table ${projectId}.${tableName} via ${engineUrl}`);

            // Engine returns the schema synchronously.
            const schemaRes = await fetch(`${engineUrl}/schema/${projectId}/${tableName}`, { headers });
            if (!schemaRes.ok) {
                const body = await schemaRes.json().catch(() => ({}));
                throw { statusCode: schemaRes.status, message: body.detail || body.message || 'Schema lookup failed' };
            }
            const schemaBody = await schemaRes.json();
            // Accept either the new shape { columns: [{name,type}, ...] } or
            // the legacy shape { resultData: [...] }.
            const schemaData = schemaBody.columns
                ? { resultData: schemaBody.columns }
                : schemaBody;

            // Query for preview data — also synchronous on the new engine.
            const queryPayload = {
                source: `${projectId}.${tableName}`,
                select: ["*"],
                filters: [],
                groupBy: [],
                orderBy: [],
                limit,
            };
            const queryRes = await fetch(`${engineUrl}/query`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify(queryPayload),
            });
            if (!queryRes.ok) {
                const body = await queryRes.json().catch(() => ({}));
                throw { statusCode: queryRes.status, message: body.detail || body.message || 'Query failed' };
            }
            const queryBody = await queryRes.json();
            // New engine returns { rows, rowCount, columns, sql }; shim returns
            // { resultData } + the above. Accept both.
            const resultData = queryBody.rows || queryBody.resultData || [];

            if (!resultData) {
                throw { statusCode: 408, message: 'Query timed out' };
            }

            // Extract columns from schema
            const columns = schemaData.columns ? schemaData.columns.map(c => c.name || c) : Object.keys(resultData[0] || {});

            return {
                jobId,
                projectId,
                tableName,
                fileName: tableName,
                columns,
                rows: resultData,
                totalRows: resultData.length,
                totalColumns: columns.length,
                source: 'lakehouse'
            };
        } catch (error) {
            if (error.statusCode) throw error;
            console.error('Lakehouse preview error:', error);
            throw { statusCode: 500, message: 'Failed to fetch lakehouse preview: ' + error.message };
        }
    }

    /**
     * Parse user intent from message
     */
    parseIntent(message) {
        if (message.includes('summarize') || message.includes('summary') || message.includes('overview')) {
            return { type: 'summarize' };
        }
        if (message.includes('chart') || message.includes('graph') || message.includes('visualize') || message.includes('plot')) {
            let chartType = 'bar';
            if (message.includes('line')) chartType = 'line';
            if (message.includes('pie')) chartType = 'pie';
            if (message.includes('scatter')) chartType = 'scatter';
            if (message.includes('bar')) chartType = 'bar';
            return { type: 'chart', chartType };
        }
        if (message.includes('anomal') || message.includes('outlier') || message.includes('unusual')) {
            return { type: 'anomalies' };
        }
        if (message.includes('trend') || message.includes('pattern') || message.includes('compare')) {
            return { type: 'trends' };
        }
        return { type: 'general' };
    }

    generateSummary(file, analysis) {
        const meta = analysis.metadata || {};
        const stats = analysis.summaryStatistics || {};
        const numericCols = Object.keys(stats).length;

        return `Here's a summary of "${file.originalFilename}":\n\n` +
            `📊 **Dataset Overview**\n` +
            `• Rows: ${meta.rowCount || 'N/A'}\n` +
            `• Columns: ${meta.columnCount || 'N/A'}\n` +
            `• Numeric columns: ${numericCols}\n\n` +
            `I can create visualizations or find anomalies. What would you like to explore?`;
    }

    generateChartResponse(file, analysis, chartType) {
        return `I've generated a ${chartType} chart based on your data. ` +
            `The visualization is now available in the Charts panel on the right.\n\n` +
            `You can ask me to try different chart types like line, bar, pie, or scatter plots.`;
    }

    generateAnomalyResponse(analysis) {
        const missing = analysis.missingValues || {};
        const missingCols = Object.entries(missing).filter(([k, v]) => v > 0);

        if (missingCols.length > 0) {
            const issues = missingCols.map(([col, count]) => `• ${col}: ${count} missing values`).join('\n');
            return `I found some data quality issues:\n\n${issues}\n\nWould you like me to help clean this data?`;
        }
        return `Good news! I didn't find any significant anomalies in your dataset. The data appears to be clean and consistent.`;
    }

    generateTrendResponse(file, analysis) {
        return `I've analyzed the trends in "${file.originalFilename}". ` +
            `Check the Charts panel for visualizations showing the patterns in your data.\n\n` +
            `Key observations are listed in the Insights tab.`;
    }

    generateGeneralResponse(file, analysis) {
        const meta = analysis.metadata || {};
        return `I'm ready to help you analyze "${file.originalFilename}" ` +
            `(${meta.rowCount || 0} rows × ${meta.columnCount || 0} columns).\n\n` +
            `Try asking:\n` +
            `• "Summarize this data"\n` +
            `• "Create a bar chart"\n` +
            `• "Find anomalies"\n` +
            `• "Show me trends"`;
    }

    generateInsights(analysis) {
        const insights = [];
        const stats = analysis.summaryStatistics || {};
        const meta = analysis.metadata || {};

        insights.push({
            type: 'kpi',
            label: 'Total Rows',
            value: meta.rowCount || 0,
            icon: '📊'
        });

        insights.push({
            type: 'kpi',
            label: 'Columns',
            value: meta.columnCount || 0,
            icon: '📋'
        });

        const missing = analysis.missingValues || {};
        const totalMissing = Object.values(missing).reduce((a, b) => a + b, 0);
        insights.push({
            type: 'kpi',
            label: 'Missing Values',
            value: totalMissing,
            icon: totalMissing > 0 ? '⚠️' : '✅'
        });

        insights.push({
            type: 'kpi',
            label: 'Data Quality',
            value: totalMissing === 0 ? 'Good' : 'Needs Review',
            icon: totalMissing === 0 ? '✅' : '🔍'
        });

        // Add bullet insights
        for (const [col, colStats] of Object.entries(stats)) {
            if (colStats.mean !== undefined) {
                insights.push({
                    type: 'bullet',
                    text: `${col}: Average ${colStats.mean.toFixed(2)}, Range ${colStats.min} - ${colStats.max}`
                });
            }
        }

        return insights;
    }

    generateAnomalyInsights(analysis) {
        const insights = [];
        const missing = analysis.missingValues || {};

        for (const [col, count] of Object.entries(missing)) {
            if (count > 0) {
                insights.push({
                    type: 'warning',
                    text: `${col} has ${count} missing values`,
                    severity: count > 10 ? 'high' : 'low'
                });
            }
        }

        if (insights.length === 0) {
            insights.push({
                type: 'success',
                text: 'No data quality issues detected'
            });
        }

        return insights;
    }

    generateChartSpecs(analysis, chartType = 'bar') {
        const stats = analysis.summaryStatistics || {};
        const columns = Object.keys(stats);

        if (columns.length === 0) return [];

        const charts = [];
        const timestamp = Date.now();

        // Generate a chart for each numeric column (up to 3)
        columns.slice(0, 3).forEach((col, index) => {
            const colStats = stats[col];
            if (colStats && colStats.mean !== undefined) {
                charts.push({
                    id: `chart-${timestamp}-${index}-${Math.random().toString(36).substr(2, 9)}`,
                    type: chartType,
                    title: `${col} Distribution`,
                    data: {
                        labels: ['Min', 'Mean', 'Max'],
                        datasets: [{
                            label: col,
                            data: [colStats.min || 0, colStats.mean || 0, colStats.max || 0],
                            backgroundColor: ['#BCFF3C', '#8BC34A', '#4CAF50']
                        }]
                    },
                    options: {
                        responsive: true,
                        plugins: {
                            legend: { display: false }
                        }
                    }
                });
            }
        });

        return charts;
    }

    generateTrendCharts(analysis) {
        const stats = analysis.summaryStatistics || {};
        const columns = Object.keys(stats);

        if (columns.length === 0) return [];

        const timestamp = Date.now();

        return columns.slice(0, 2).map((col, index) => {
            const colStats = stats[col];
            return {
                id: `trend-${timestamp}-${index}-${Math.random().toString(36).substr(2, 9)}`,
                type: 'line',
                title: `${col} Trend`,
                data: {
                    labels: ['Min', 'Q1', 'Median', 'Q3', 'Max'],
                    datasets: [{
                        label: col,
                        data: [
                            colStats.min || 0,
                            colStats.q1 || colStats.min || 0,
                            colStats.median || colStats.mean || 0,
                            colStats.q3 || colStats.max || 0,
                            colStats.max || 0
                        ],
                        borderColor: '#BCFF3C',
                        backgroundColor: 'rgba(188, 255, 60, 0.1)',
                        tension: 0.4
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: { display: false }
                    }
                }
            };
        });
    }
}

module.exports = ChatService;
