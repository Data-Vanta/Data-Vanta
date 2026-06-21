package com.datalake.spark.model.query;

/**
 * Represents a filter condition for query WHERE clause.
 */
public class FilterCondition {
    private String column;
    private String operator;  // =, !=, >, <, >=, <=, LIKE, IN, BETWEEN
    private Object value;
    private Object value2;    // For BETWEEN operator

    public String getColumn() {
        return column;
    }

    public void setColumn(String column) {
        this.column = column;
    }

    public String getOperator() {
        return operator;
    }

    public void setOperator(String operator) {
        this.operator = operator;
    }

    public Object getValue() {
        return value;
    }

    public void setValue(Object value) {
        this.value = value;
    }

    public Object getValue2() {
        return value2;
    }

    public void setValue2(Object value2) {
        this.value2 = value2;
    }

    @Override
    public String toString() {
        return "FilterCondition{" +
                "column='" + column + '\'' +
                ", operator='" + operator + '\'' +
                ", value=" + value +
                ", value2=" + value2 +
                '}';
    }
}
