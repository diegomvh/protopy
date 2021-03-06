var EmptyResultSet = type('EmptyResultSet', Exception);
var FullResultSet = type('FullResultSet', Exception);

/*
    * Used by join construction code to indicate the point at which a
    * multi-valued join was attempted (if the caller wants to treat that
    * exceptionally).
    */
var MultiJoin = type('MultiJoin', [ Exception ], {
    __init__: function(level) {
        this.level = level;
    }
});

var RawValue = type('RawValue', [ object ], {
    __init__: function(value) {
        this.value = value;
    }
});

/*
 * Add a date selection column.
 */
var Date = type('Date', [ object ], {

    __init__: function(col, lookup_type, date_sql_func){
        this.col = col;
        this.lookup_type = lookup_type;
        this.date_sql_func = date_sql_func;
    },

    relabel_aliases: function(change_map){
        var c = this.col;
        if (type(c) == Array)
            this.col = [change_map.get(c[0], c[0]), c[1]];
    },

    as_sql: function(quote_func) {
        if (!quote_func)
            quote_func = function (x) {return x};
        if (type(this.col) == Array)
            var col = ['%s.%s'.subs([quote_func(c) for (c in this.col)])];
        else if (this.col['as_sql'])
            var col = this.col.as_sql(quote_func);
        else
            var col = this.col;
        return this.date_sql_func(this.lookup_type, col);
    }
});

publish({
    EmptyResultSet: EmptyResultSet,
    FullResultSet: FullResultSet,
    MultiJoin: MultiJoin,
    RawValue: RawValue,
    Date: Date
});
