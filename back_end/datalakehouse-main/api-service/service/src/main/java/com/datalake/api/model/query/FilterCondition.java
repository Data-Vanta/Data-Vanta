package com.datalake.api.model.query;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * Represents a filter condition (WHERE clause).
 * 
 * Example: {"column": "Date", "operator": ">=", "value": "2023-01-01"}
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class FilterCondition {

    /**
     * Column name to filter on
     */
    @NotBlank(message = "column is required")
    private String column;

    /**
     * Operator: =, !=, <, <=, >, >=, LIKE, IN, IS NULL, IS NOT NULL
     */
    @NotBlank(message = "operator is required")
    private String operator;

    /**
     * Value to compare against (can be null for IS NULL/IS NOT NULL)
     */
    @NotNull(message = "value is required")
    private Object value;
}
