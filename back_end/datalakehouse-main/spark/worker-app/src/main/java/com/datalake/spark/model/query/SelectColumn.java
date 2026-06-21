package com.datalake.spark.model.query;

/**
 * Represents a column selection with optional aggregation and alias.
 */
public class SelectColumn {
    private String column;
    private String aggregation;  // sum, avg, count, min, max, etc.
    private String as;           // Alias for the result column

    public String getColumn() {
        return column;
    }

    public void setColumn(String column) {
        this.column = column;
    }

    public String getAggregation() {
        return aggregation;
    }

    public void setAggregation(String aggregation) {
        this.aggregation = aggregation;
    }

    public String getAs() {
        return as;
    }

    public void setAs(String as) {
        this.as = as;
    }

    @Override
    public String toString() {
        return "SelectColumn{" +
                "column='" + column + '\'' +
                ", aggregation='" + aggregation + '\'' +
                ", as='" + as + '\'' +
                '}';
    }
}
