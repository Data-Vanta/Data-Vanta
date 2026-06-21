package com.datalake.api.model.query;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.util.List;

/**
 * Main query request model that accepts structured JSON queries
 * for retrieving data from Iceberg tables.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class QueryRequest {

    /**
     * Source identifier - can be:
     * - "uploaded_file" (query from uploaded data)
     * - table name in format "projectId.tableName"
     */
    @NotBlank(message = "source is required")
    private String source;

    /**
     * Columns to select with optional aggregations and aliases
     */
    @NotNull(message = "select is required")
    @Valid
    private List<SelectColumn> select;

    /**
     * Optional filter conditions (WHERE clause)
     */
    @Valid
    private List<FilterCondition> filters;

    /**
     * Optional GROUP BY columns
     */
    private List<String> groupBy;

    /**
     * Optional ORDER BY clauses
     */
    @Valid
    private List<OrderBy> orderBy;

    /**
     * Optional result limit
     */
    private Integer limit;

    /**
     * Optional encoding hints for client-side visualization
     * (not used in query execution, passed through to response)
     */
    private Encoding encoding;
}
