package com.datalake.api.model.query;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import jakarta.validation.constraints.NotBlank;

/**
 * Represents a column selection with optional aggregation and alias.
 * 
 * Examples:
 * - Simple select: {"column": "Date", "as": "x"}
 * - Aggregation: {"column": "Sales", "aggregation": "sum", "as": "total_sales"}
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SelectColumn {

    /**
     * Column name from the table
     */
    @NotBlank(message = "column is required")
    private String column;

    /**
     * Optional aggregation function: sum, avg, count, min, max, etc.
     */
    private String aggregation;

    /**
     * Optional alias for the result column
     */
    private String as;
}
