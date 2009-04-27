$D("doff.core.management.commands.syncdb");
$L('doff.db.*', 'connection');
$L('doff.db.models.*');
$L('doff.db.transaction');
$L('doff.core.project', 'get_settings');

function execute() {
    var settings = get_settings();
    /* No creo que sea necesario
    for each (var app_name in settings.INSTALLED_APPS) {
	try {
	    $L(app_name + '.management');
	} catch (e if e instanceof LoadError) { }
    }
    */
    var cursor = connection.cursor();
    
    // Get a list of already installed *models* so that references work right.
    var tables = connection.introspection.table_names();
    var seen_models = connection.introspection.installed_models(tables);
    var created_models = new Set();
    var pending_references = new Dict();

    // Create the tables for each model
    for each (var app in models.get_apps()) {
        var app_name = app.__name__.split('.').slice(-2)[0];
        var model_list = models.get_models(app);
        for each (var model in model_list) {
            // Create the model's database table, if it doesn't already exist.
            if (include(tables, connection.introspection.table_name_converter(model._meta.db_table)))
                continue;
            var [sql, references] = connection.creation.sql_create_model(model, seen_models);
            seen_models.add(model);
            created_models.add(model);
            for each (var [refto, refs] in references) {
                var result = pending_references.setdefault(refto, []);
                pending_references.set(refto, result.concat(refs));
                if (include(seen_models, refto))
                    sql = sql.concat(connection.creation.sql_for_pending_references(refto, pending_references));
            }
            sql = sql.concat(connection.creation.sql_for_pending_references(model, pending_references));
            for each (var statement in sql) {
                try {
                    cursor.execute(statement);
                } catch (e) { print(e); }
            }
            tables.push(connection.introspection.table_name_converter(model._meta.db_table));
        }
    }

    // Create the m2m tables. This must be done after all tables have been created
    // to ensure that all referred tables will exist.
    for each (var app in models.get_apps()) {
        var app_name = app.__name__.split('.').slice(-2)[0];
        var model_list = models.get_models(app);
        for each (var model in model_list) {
            if (include(created_models, model)) {
                var sql = connection.creation.sql_for_many_to_many(model);
                if (bool(sql)) {
                    for each (var statement in sql)
                    cursor.execute(statement);
                }
            }
        }
    }

    transaction.commit_unless_managed();

    // Send the post_syncdb signal, so individual apps can do whatever they need
    // to do at this point.
    //emit_post_sync_signal(created_models, verbosity, interactive);

    // The connection may have been closed by a syncdb handler.
    cursor = connection.cursor();

    // Install custom SQL for the app (but only if this
    // is a model we've just created)
    for each (var app in models.get_apps()) {
        var app_name = app.__name__.split('.').slice(-2)[0];
        for each (var model in models.get_models(app)) {
            if (include(created_models, model)) {
                var custom_sql = null //custom_sql_for_model(model);
                if (custom_sql) {
                    try {
                        for (var sql in custom_sql)
                            cursor.execute(sql);
                    } catch (e) {
                        print("Failed to install custom SQL for %s.%s model: %s".subs(app_name, model._meta.object_name, e));
                        transaction.rollback_unless_managed();
                    } finally {
                        transaction.commit_unless_managed();
                    }
                }
            }
        }
    }
    // Install SQL indicies for all newly created models
    for each (var app in models.get_apps()) {
        var app_name = app.__name__.split('.').slice(-2)[0];
        for each (var model in models.get_models(app)) {
            if (include(created_models, model)) {
                var index_sql = connection.creation.sql_indexes_for_model(model);
                if (index_sql) {
                    try {
                        for each (var sql in index_sql)
                            cursor.execute(sql);
                    } catch (e) {
                        print("Failed to install index for %s.%s model: %s".subs(app_name, model._meta.object_name, e));
                        transaction.rollback_unless_managed()
                    } finally {
                        transaction.commit_unless_managed();
                    }
                }
            }
        }
    }
    
    // Install the 'initial_data' fixture, using format discovery
    //from django.core.management import call_command
    //call_command('loaddata', 'initial_data', verbosity=verbosity)
}

$P({ 'execute': execute });