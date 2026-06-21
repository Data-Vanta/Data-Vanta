package com.datalake.spark.model.query;

/**
 * Represents an ORDER BY clause.
 */
public class OrderBy {
    private String column;
    private String direction;  // asc or desc

    public String getColumn() {
        return column;
    }

    public void setColumn(String column) {
        this.column = column;
    }

    public String getDirection() {
        return direction;
    }

    public void setDirection(String direction) {
        this.direction = direction;
    }

    @Override
    public String toString() {
        return "OrderBy{" +
                "column='" + column + '\'' +
                ", direction='" + direction + '\'' +
                '}';
    }
}
