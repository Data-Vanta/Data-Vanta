// Chart TypeScript types for Data Vanta
// Maps API response to frontend rendering

export interface ChartDataset {
    label?: string;
    data?: number[];
    backgroundColor?: string[];
}

export interface ChartData {
    labels?: string[];
    datasets?: ChartDataset[];
    resultData?: unknown[];
    rowCount?: number;
}

export interface ChartEncoding {
    x?: string;
    y?: string;
    color?: string;
    size?: string;
}

export interface ChartSpec {
    id: string;
    type: string;
    title: string;
    chart_id?: string | number;
    chart_type?: string; // Accept any string from API, will be validated at runtime
    encoding?: ChartEncoding;
    data?: ChartData;
}

// All supported chart types from backend charts_config.py
export type ChartType =
    | 'bar_chart'
    | 'histogram'
    | 'line_chart'
    | 'area_chart'
    | 'smooth_line_chart'
    | 'stepped_line_chart'
    | 'pie_chart'
    | 'donut_chart'
    | 'heatmap'
    | 'calendar_heatmap'
    | 'scatter_plot'
    | 'bubble_chart'
    | 'big_number'
    | 'big_number_with_trendline'
    | 'box_plot'
    | 'waterfall_chart'
    | 'funnel_chart'
    | 'radar_chart'
    | 'sunburst_chart'
    | 'tree_chart'
    | 'tree_map_chart'
    | 'horizon_chart'
    | 'word_cloud'
    | 'pivot_table'
    | 'paired_t_test_table';

// Theme colors matching the dark UI
export const CHART_COLORS = [
    '#BCFF3C', // Primary lime green
    '#3CBCFF', // Blue
    '#FF3CBC', // Pink
    '#FFBC3C', // Orange
    '#3CFFBC', // Teal
    '#BC3CFF', // Purple
    '#FF6B6B', // Coral
    '#4ECDC4', // Aqua
    '#FFE66D', // Yellow
    '#95E1D3', // Mint
];

// Dark theme configuration for ECharts
export const CHART_THEME = {
    backgroundColor: 'transparent',
    textStyle: {
        color: '#888',
    },
    title: {
        textStyle: {
            color: '#fff',
        },
    },
    legend: {
        textStyle: {
            color: '#888',
        },
    },
    tooltip: {
        backgroundColor: 'rgba(17, 17, 17, 0.95)',
        borderColor: '#333',
        textStyle: {
            color: '#fff',
        },
    },
    xAxis: {
        axisLine: { lineStyle: { color: '#333' } },
        axisLabel: { color: '#888' },
        splitLine: { lineStyle: { color: '#222' } },
    },
    yAxis: {
        axisLine: { lineStyle: { color: '#333' } },
        axisLabel: { color: '#888' },
        splitLine: { lineStyle: { color: '#222' } },
    },
};
