/* 
 * A JavaScript "serializer". Doesn't do much serializing per se -- just converts to
 * and from basic JavaScript data types (lists, dicts, strings, etc.). Useful as a basis for other serializers.
 */

require('doff.core.serializers.javascript', 'Serializer');
require('doff.core.serializers.base', 'DeserializedObject', 'DeserializationError');
var models = require('doff.db.models.base');

var RemoteSerializer = type('RemoteSerializer', [ Serializer ], {

    serialize: function(queryset_or_model) {
        var is_model = isinstance(queryset_or_model, models.Model);
        if (is_model)
            return super(Serializer, this).serialize([ queryset_or_model ])[0];
        return super(Serializer, this).serialize(queryset_or_model);
    },

    start_object: function(obj) {
        this._current = {};
    },

    end_object: function(obj) {
        var values = {
            "model"  : string(obj._meta),
            "fields" : this._current
        };
        if (obj.server_pk != null)
            values["pk"] = obj.server_pk;
        this.objects.push(values);
        this._current = null;
    },

    handle_fk_field: function(obj, field) {
        var related = getattr(obj, field.name);
        if (related != null) {
            if (field.rel.field_name == related._meta.pk.name) {
                // Related to remote object via primary key
                related = related.server_pk;
            } else {
                // Related to remote object via other field
                related = getattr(related, field.rel.field_name);
            }
        }
        this._current[field.name] = related;
    },

    handle_m2m_field: function(obj, field) {
        if (field.creates_table) {
            this._current[field.name] = [string(related.server_pk)
                for each (related in getattr(obj, field.name).iterator())];
        }
    }
});

/* Quiza un nombre mejor para esto, porque no solo deserializa sino que tambien 
 * transforma los objetos del servidor en objetos del cliente
 */
function RemoteDeserializer(object_list, sync_log) {
    /* Para pasar los datos a objetos de modelo asume que ya estan ordenados al obtener las referencias */
    models.get_apps();
    for each (var d in object_list) {
        // Look up the model and starting build a dict of data for it.
        var Model = models.get_model_by_identifier(d["model"]);
        if (Model == null)
            throw new sbase.DeserializationError("Invalid model identifier: '%s'".subs(model_identifier));
        var data = {'sync_log': sync_log,
                    'server_pk': d["server_pk"],
                    'active': d["active"],
                    'status': "s"};
        try {
            // Search if exist instance
            var client_object = Model._default_manager.get({'server_pk': data["server_pk"]});
            // Si estoy aca es porque la instancia existe, levanto el pk y lo marco
            data[Model._meta.pk.attname] = client_object[Model._meta.pk.attname];
        } catch (e if isinstance(e, Model.DoesNotExist)) {}
        var m2m_data = {};

        // Handle each field
        for each (var [field_name, field_value] in items(d["fields"])) {
            //Esto esta copiado por el tema de unicode
            if (isinstance(field_value, String))
                field_value = string(field_value);

            var field = Model._meta.get_field(field_name);

            // Handle M2M relations
            if (field.rel && isinstance(field.rel, models.ManyToManyRel)) {
                var m2m_convert = getattr(field.rel.to._meta.pk, 'to_javascript');
                // Map to client pks
                field_value = [field.rel.to._default_manager.get({'server_pk': f})[Model._meta.pk.attname] for each (f in field_value)]
                m2m_data[field.name] = [m2m_convert(string(pk)) for each (pk in field_value)];
            } else if (field.rel && isinstance(field.rel, models.ManyToOneRel)) { // Handle FK fields
                if (field_value != null) {
                    // Map to client pk
                    field_value = field.rel.to._default_manager.get({'server_pk': field_value})[Model._meta.pk.attname];
                    data[field.attname] = field.rel.to._meta.get_field(field.rel.field_name).to_javascript(field_value);
                } else {
                    data[field.attname] = null;
                }
            } else {// Handle all other fields
                data[field.name] = field.to_javascript(field_value);
            }
        }
        //TODO: Que pasa cuando no esta activo y no tengo instancia... eso es un error
        if (data['active']) {
            // Puede ser un objeto nuevo o un update
            yield new DeserializedObject(new Model(data), m2m_data);
        } else {
            // Es un inactive del objeto que ya existe
            client_object.active = data['active'];
            client_object.status = data['status'];
            yield new DeserializedObject(client_object, m2m_data);
        }
    }
}

publish({
    RemoteSerializer: RemoteSerializer,
    RemoteDeserializer: RemoteDeserializer,
});