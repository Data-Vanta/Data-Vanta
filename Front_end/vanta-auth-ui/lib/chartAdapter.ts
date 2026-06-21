// Chart Adapter Layer
// Transforms API chart specs to ECharts options

import type { EChartsOption } from 'echarts';
import { ChartSpec, ChartType, CHART_COLORS, CHART_THEME } from './chartTypes';

/**
 * Convert backend chart spec to ECharts option
 */
export function chartSpecToEChartsOption(spec: ChartSpec): EChartsOption {
    const chartType = (spec.chart_type || spec.type || 'bar_chart') as ChartType;
    const labels = spec.data?.labels || [];
    const datasets = spec.data?.datasets || [];
    const primaryData = datasets[0]?.data || [];

    // Base option with dark theme
    const baseOption: EChartsOption = {
        ...CHART_THEME,
        animation: true,
        animationDuration: 500,
        grid: {
            left: '3%',
            right: '4%',
            bottom: '3%',
            top: 40,
            containLabel: true,
        },
    };

    switch (chartType) {
        case 'bar_chart':
        case 'histogram':
            return createBarChart(baseOption, labels, primaryData, spec);

        case 'line_chart':
            return createLineChart(baseOption, labels, primaryData, spec, { smooth: false });

        case 'smooth_line_chart':
            return createLineChart(baseOption, labels, primaryData, spec, { smooth: true });

        case 'stepped_line_chart':
            return createLineChart(baseOption, labels, primaryData, spec, { step: 'middle' });

        case 'area_chart':
            return createLineChart(baseOption, labels, primaryData, spec, { areaStyle: true });

        case 'pie_chart':
            return createPieChart(baseOption, labels, primaryData, spec, { donut: false });

        case 'donut_chart':
            return createPieChart(baseOption, labels, primaryData, spec, { donut: true });

        case 'scatter_plot':
            return createScatterChart(baseOption, labels, primaryData, spec, { bubble: false });

        case 'bubble_chart':
            return createScatterChart(baseOption, labels, primaryData, spec, { bubble: true });

        case 'heatmap':
        case 'calendar_heatmap':
            return createHeatmapChart(baseOption, labels, primaryData);

        case 'radar_chart':
            return createRadarChart(baseOption, labels, primaryData, spec);

        case 'funnel_chart':
            return createFunnelChart(baseOption, labels, primaryData);

        case 'big_number':
        case 'big_number_with_trendline':
            // These are handled specially in ChartRenderer
            return baseOption;

        default:
            // Fallback to bar chart
            return createBarChart(baseOption, labels, primaryData, spec);
    }
}

function createBarChart(
    base: EChartsOption,
    labels: string[],
    data: number[],
    spec: ChartSpec
): EChartsOption {
    return {
        ...base,
        tooltip: {
            ...CHART_THEME.tooltip,
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
        },
        xAxis: {
            type: 'category',
            data: labels,
            ...CHART_THEME.xAxis,
            axisLabel: {
                ...CHART_THEME.xAxis.axisLabel,
                rotate: labels.length > 6 ? 45 : 0,
                interval: 0,
            },
        },
        yAxis: {
            type: 'value',
            ...CHART_THEME.yAxis,
        },
        series: [
            {
                name: spec.encoding?.y || 'Value',
                type: 'bar',
                data: data.map((val, idx) => ({
                    value: val,
                    itemStyle: { color: CHART_COLORS[idx % CHART_COLORS.length] },
                })),
                barMaxWidth: 50,
                emphasis: {
                    itemStyle: { shadowBlur: 10, shadowColor: 'rgba(188, 255, 60, 0.5)' },
                },
            },
        ],
    };
}

function createLineChart(
    base: EChartsOption,
    labels: string[],
    data: number[],
    spec: ChartSpec,
    options: { smooth?: boolean; step?: 'start' | 'middle' | 'end'; areaStyle?: boolean }
): EChartsOption {
    return {
        ...base,
        tooltip: {
            ...CHART_THEME.tooltip,
            trigger: 'axis',
        },
        xAxis: {
            type: 'category',
            data: labels,
            boundaryGap: false,
            ...CHART_THEME.xAxis,
        },
        yAxis: {
            type: 'value',
            ...CHART_THEME.yAxis,
        },
        series: [
            {
                name: spec.encoding?.y || 'Value',
                type: 'line',
                data: data,
                smooth: options.smooth || false,
                step: options.step,
                symbol: 'circle',
                symbolSize: 6,
                lineStyle: { color: CHART_COLORS[0], width: 2 },
                itemStyle: { color: CHART_COLORS[0] },
                areaStyle: options.areaStyle
                    ? {
                        color: {
                            type: 'linear',
                            x: 0, y: 0, x2: 0, y2: 1,
                            colorStops: [
                                { offset: 0, color: 'rgba(188, 255, 60, 0.4)' },
                                { offset: 1, color: 'rgba(188, 255, 60, 0)' },
                            ],
                        },
                    }
                    : undefined,
            },
        ],
    };
}

function createPieChart(
    base: EChartsOption,
    labels: string[],
    data: number[],
    spec: ChartSpec,
    options: { donut: boolean }
): EChartsOption {
    const pieData = labels.map((label, idx) => ({
        name: label,
        value: data[idx] || 0,
        itemStyle: { color: CHART_COLORS[idx % CHART_COLORS.length] },
    }));

    return {
        ...base,
        tooltip: {
            ...CHART_THEME.tooltip,
            trigger: 'item',
            formatter: '{b}: {c} ({d}%)',
        },
        legend: {
            orient: 'vertical',
            right: 10,
            top: 'center',
            ...CHART_THEME.legend,
        },
        series: [
            {
                type: 'pie',
                radius: options.donut ? ['40%', '70%'] : '70%',
                center: ['40%', '50%'],
                data: pieData,
                emphasis: {
                    itemStyle: {
                        shadowBlur: 10,
                        shadowOffsetX: 0,
                        shadowColor: 'rgba(0, 0, 0, 0.5)',
                    },
                },
                label: {
                    color: '#888',
                },
            },
        ],
    };
}

function createScatterChart(
    base: EChartsOption,
    labels: string[],
    data: number[],
    spec: ChartSpec,
    options: { bubble: boolean }
): EChartsOption {
    const maxVal = Math.max(...data, 1);
    const scatterData = labels.map((label, idx) => {
        const val = data[idx] || 0;
        return {
            name: label,
            value: [idx, val],
            symbolSize: options.bubble ? 10 + (val / maxVal) * 40 : 12,
            itemStyle: { color: CHART_COLORS[idx % CHART_COLORS.length] },
        };
    });

    return {
        ...base,
        tooltip: {
            ...CHART_THEME.tooltip,
            trigger: 'item',
            formatter: (params: unknown) => {
                const p = params as { name?: string; value?: unknown[] };
                return `${p.name || ''}: ${Array.isArray(p.value) ? p.value[1] : ''}`;
            },
        },
        xAxis: {
            type: 'category',
            data: labels,
            ...CHART_THEME.xAxis,
        },
        yAxis: {
            type: 'value',
            ...CHART_THEME.yAxis,
        },
        series: [
            {
                type: 'scatter',
                data: scatterData,
                emphasis: {
                    scale: 1.2,
                },
            },
        ],
    };
}

function createHeatmapChart(
    base: EChartsOption,
    labels: string[],
    data: number[]
): EChartsOption {
    // Simple heatmap: single row with labels as X axis
    const heatmapData = labels.map((label, idx) => [idx, 0, data[idx] || 0]);
    const maxVal = Math.max(...data, 1);

    return {
        ...base,
        tooltip: {
            ...CHART_THEME.tooltip,
            position: 'top',
            formatter: (params: unknown) => {
                const p = params as { data?: unknown[] };
                const data = p.data as number[] | undefined;
                if (!data || !Array.isArray(data)) return '';
                return `${labels[data[0]] || ''}: ${data[2]}`;
            },
        },
        xAxis: {
            type: 'category',
            data: labels,
            splitArea: { show: true },
            ...CHART_THEME.xAxis,
        },
        yAxis: {
            type: 'category',
            data: ['Value'],
            splitArea: { show: true },
            ...CHART_THEME.yAxis,
        },
        visualMap: {
            min: 0,
            max: maxVal,
            calculable: true,
            orient: 'horizontal',
            left: 'center',
            bottom: 0,
            inRange: {
                color: ['#1a1a1a', '#3c5a0f', '#78b01e', '#BCFF3C'],
            },
            textStyle: { color: '#888' },
        },
        series: [
            {
                type: 'heatmap',
                data: heatmapData,
                label: { show: true, color: '#fff' },
                emphasis: {
                    itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0, 0, 0, 0.5)' },
                },
            },
        ],
    };
}

function createRadarChart(
    base: EChartsOption,
    labels: string[],
    data: number[],
    spec: ChartSpec
): EChartsOption {
    const maxVal = Math.max(...data, 1);
    const indicator = labels.map((label) => ({ name: label, max: maxVal * 1.2 }));

    return {
        ...base,
        tooltip: {
            ...CHART_THEME.tooltip,
        },
        radar: {
            indicator,
            axisName: { color: '#888' },
            splitArea: { areaStyle: { color: ['#111', '#1a1a1a'] } },
            axisLine: { lineStyle: { color: '#333' } },
            splitLine: { lineStyle: { color: '#333' } },
        },
        series: [
            {
                type: 'radar',
                data: [
                    {
                        value: data,
                        name: spec.encoding?.y || 'Value',
                        areaStyle: { color: 'rgba(188, 255, 60, 0.3)' },
                        lineStyle: { color: CHART_COLORS[0] },
                        itemStyle: { color: CHART_COLORS[0] },
                    },
                ],
            },
        ],
    };
}

function createFunnelChart(
    base: EChartsOption,
    labels: string[],
    data: number[]
): EChartsOption {
    const funnelData = labels.map((label, idx) => ({
        name: label,
        value: data[idx] || 0,
        itemStyle: { color: CHART_COLORS[idx % CHART_COLORS.length] },
    }));

    return {
        ...base,
        tooltip: {
            ...CHART_THEME.tooltip,
            trigger: 'item',
            formatter: '{b}: {c}',
        },
        series: [
            {
                type: 'funnel',
                left: '10%',
                width: '80%',
                sort: 'descending',
                gap: 2,
                label: { position: 'inside', color: '#fff' },
                data: funnelData,
            },
        ],
    };
}

/**
 * Check if chart type should use BigNumber component instead of ECharts
 */
export function isBigNumberChart(chartType: string): boolean {
    return chartType === 'big_number' || chartType === 'big_number_with_trendline';
}

/**
 * Normalize numeric values (handle string numbers, nulls)
 */
export function normalizeData(data: unknown[]): number[] {
    return data.map((val) => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
            const num = parseFloat(val.replace(/[^0-9.-]/g, ''));
            return isNaN(num) ? 0 : num;
        }
        return 0;
    });
}
