import type { ComponentType } from 'react';
import ChartWidget from './ChartWidget';
import MarkdownWidget from './MarkdownWidget';
import BigNumberWidget from './BigNumberWidget';
import IframeWidget from './IframeWidget';
import QueryWidget from './QueryWidget';

export type WidgetRendererProps = {
    config: Record<string, unknown>;
    isEditing: boolean;
    /** IDs are optional because pinned-from-chat widgets pre-date them. */
    dashboardId?: string;
    widgetId?: string;
    onConfigChange?: (next: Record<string, unknown>) => void;
    /**
     * Phase 13 — board-level cross-filters merged into the widget's
     * own filters at refresh time. Each entry: {col, op, value}.
     */
    boardFilters?: Array<{ col: string; op: string; value: unknown }>;
    /** Click handler for chart points; lets the parent build cross-filters. */
    onPointClick?: (event: {
        widgetId: string;
        field: string;
        value: string | number;
    }) => void;
    /**
     * Bumped by the board when "Refresh all" is clicked, forcing every
     * widget to re-fetch even if its config didn't change.
     */
    refreshNonce?: number;
};

export type WidgetSpec = {
    type: string;
    label: string;
    defaultGrid: { gridW: number; gridH: number };
    Component: ComponentType<WidgetRendererProps>;
};

export const WIDGETS: Record<string, WidgetSpec> = {
    chart: {
        type: 'chart',
        label: 'Chart',
        defaultGrid: { gridW: 6, gridH: 4 },
        Component: ChartWidget,
    },
    markdown: {
        type: 'markdown',
        label: 'Markdown',
        defaultGrid: { gridW: 6, gridH: 3 },
        Component: MarkdownWidget,
    },
    'big-number': {
        type: 'big-number',
        label: 'Big number',
        defaultGrid: { gridW: 3, gridH: 2 },
        Component: BigNumberWidget,
    },
    iframe: {
        type: 'iframe',
        label: 'Embed (iframe)',
        defaultGrid: { gridW: 6, gridH: 4 },
        Component: IframeWidget,
    },
    query: {
        type: 'query',
        label: 'Chart from data',
        defaultGrid: { gridW: 6, gridH: 4 },
        Component: QueryWidget,
    },
};
