require('sys');

var Connection = type('Connection', object, {
    '__init__': function __init__(options) {
        this.database = options['database'];
        this.detect_types = options['detect_types'];
        this.factory = options['factory'] || Cursor;
	try {
            this.connection = google.gears.factory.create('beta.database');
            this.connection.open(this.database);
        } catch(ex) {
            throw new Exception("couldn`t open database: " + name + " exception: " + ex.message || ex.description || String(ex));
        }
    },

    'cursor': function cursor() {
        var cur = new this.factory(this.connection);
        return cur;
    },

    'execute': function execute(query, params) {
        try {
            return this.connection.execute(query, params);
        }
        catch(ex) {
            throw new Exception(ex.message || ex.description || String(ex));
        }
    },
});

var Cursor = type('Cursor', object, {
    '__init__': function __init__(connection){
            this.connection = connection;
            this.lastResulSet = null;
    },

    get lastrowid(){
        return this.connection.lastInsertRowId;
    },

    get rowsAffected(){
        return this.connection.rowsAffected;
    },

    'close': function close(){
        try {
            this.connection.close();
        }
        catch(e) {
            throw new Exception(e.message);
        }
    },

    'remove': function remove(){
        try {
            this.connection.remove();
        }
        catch(e) {
            throw new Exception(e.message);
        }
    },

    'execute': function execute(query, params){
        params = params || [];
        try {
            this.lastResulSet = this.connection.execute(query, params);
        }
        catch(e) {
            throw new Exception(e.message);
        }
    },

    'executemany': function executemany(query, param_list) {
        try {
            for each (var params in param_list)
                this.connection.execute(query, params);
        } catch (e) {}
        return null;
    },

    'fetchone': function fetchone(){
        try {
            return this.next();
        } catch (stop) { 
            return null 
        };
    },

    'fetchmany': function fetchmany(chunk_size) {
        if (!chunk_size) return this.fetchone();
        if (!this.lastResulSet.isValidRow() || this.lastResulSet.fieldCount() == 0) return [];
        var result = [];
        try {
            for (var i = 0; i < chunk_size; i++){
                result.push(this.next());
            }
        } catch (stop) {
            return result;
        };
    },

    'fetchall': function fetchall(){
        if (!this.lastResulSet.isValidRow() || this.lastResulSet.fieldCount() == 0) return [];
        var result = [];
        var result = [];
        try {
            while (true)
                result.push(this.next());
        } catch (stop) {
            return result;
        };
    },

    'next': function next() {
        if (this.lastResulSet == null)
            throw StopIteration;
        if (!this.lastResulSet.isValidRow()) throw StopIteration;
        var tupla = {};
        for (var i = 0, length = this.lastResulSet.fieldCount(); i < length; i++) {
            var name = this.lastResulSet.fieldName(i);
            var value = this.lastResulSet.field(i);
            tupla[name] = value;
            tupla[i] = value;
        }
        this.lastResulSet.next();
        return tupla;
    }
});

publish({    
    connect: function(options) { return new Connection(options); },
    Cursor: Cursor,
    DatabaseError: type('DatabaseError', [ object ]),
    IntegrityError: type('IntegrityError', [ object ])
});