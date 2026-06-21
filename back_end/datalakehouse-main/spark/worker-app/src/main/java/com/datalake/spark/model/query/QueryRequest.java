package com.datalake.spark.model.query;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;

/**
 * Represents a query request for retrieving data from Iceberg tables.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class QueryRequest {
    private String source;  // Table identifier: "projectId.tableName"
    private List<SelectColumn> select;
    private List<FilterCondition> filters;
    private List<String> groupBy;
    private List<OrderBy> orderBy;
    private Integer limit;
    private Integer offset;  // For pagination

    // Getters and Setters
    public String getSource() {
        return source;
    }

    public void setSource(String source) {
        this.source = source;
    }

    public List<SelectColumn> getSelect() {
        return select;
    }

    public void setSelect(List<SelectColumn> select) {
        this.select = select;
    }

    public List<FilterCondition> getFilters() {
        return filters;
    }

    public void setFilters(List<FilterCondition> filters) {
        this.filters = filters;
    }

    public List<String> getGroupBy() {
        return groupBy;
    }

    public void setGroupBy(List<String> groupBy) {
        this.groupBy = groupBy;
    }

    public List<OrderBy> getOrderBy() {
        return orderBy;
    }

    public void setOrderBy(List<OrderBy> orderBy) {
        this.orderBy = orderBy;
    }

    public Integer getLimit() {
        return limit;
    }

    public void setLimit(Integer limit) {
        this.limit = limit;
    }

    public Integer getOffset() {
        return offset;
    }

    public void setOffset(Integer offset) {
        this.offset = offset;
    }

    @Override
    public String toString() {
        return "QueryRequest{" +
                "source='" + source + '\'' +
                ", select=" + select +
                ", filters=" + filters +
                ", groupBy=" + groupBy +
                ", orderBy=" + orderBy +
                ", limit=" + limit +
                ", offset=" + offset +
                '}';
    }
}
