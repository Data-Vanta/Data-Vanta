package com.datalake.api.model.query;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Optional encoding hints for visualization (e.g., Vega-Lite).
 * This is passed through to the response and not used in query execution.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Encoding {
    private String x;
    private String y;
    private String color;
    private String size;
    private String shape;
}
