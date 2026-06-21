package com.datalake.api.model.query;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Builder.Default;
import lombok.Data;
import lombok.NoArgsConstructor;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/**
 * Represents an ORDER BY clause.
 * 
 * Example: {"column": "Date", "direction": "asc"}
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class OrderBy {

    /**
     * Column name to order by
     */
    @NotBlank(message = "column is required")
    private String column;

    /**
     * Sort direction: "asc" or "desc"
     */
    @Pattern(regexp = "(?i)asc|desc", message = "direction must be 'asc' or 'desc'")
    @Default
    private String direction = "asc";
}
