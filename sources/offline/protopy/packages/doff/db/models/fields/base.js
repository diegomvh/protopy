require('doff.db.base', 'connection');
require('doff.db.models.query_utils', 'QueryWrapper');
require('doff.conf.settings', 'settings');
var forms = require('doff.forms.base');
require('doff.core.exceptions', 'ValidationError');
require('functional', 'curry');
require('copy', 'copy');

var NOT_PROVIDED = type('NOT_PROVIDED', [ Exception ]);

// The values to use for "blank" in SelectFields. Will be appended to the start of most "choices" lists.
var BLANK_CHOICE_DASH = [["", "---------"]];
var BLANK_CHOICE_NONE = [["", "None"]];

var FieldDoesNotExist = type('FieldDoesNotExist', [ Exception ]);

var Field = type('Field', [ object ], {
    creation_counter: 0,
    auto_creation_counter: -1
},{
    empty_strings_allowed: true,
    __init__: function() {

        var arg = new Arguments(arguments, {'verbose_name':null, 'name':null, 'primary_key':false,
            'max_length':null, 'unique':false, 'blank':false, 'null':false,
            'db_index':false, 'rel':null, 'default':NOT_PROVIDED, 'editable':true,
            'serialize':true, 'unique_for_date':null, 'unique_for_month':null,
            'unique_for_year':null, 'choices':[], 'help_text':'', 'db_column':null,
            'db_tablespace':settings.DEFAULT_INDEX_TABLESPACE, 'auto_created':false});
        var args = arg.args;
        var kwargs = arg.kwargs;

        this.name = kwargs['name'];
        this.verbose_name = (args.length == 1)? args[0] : kwargs['verbose_name'];
        this.primary_key = kwargs['primary_key'];
        this.max_length = kwargs['max_length']
        this._unique = kwargs['unique'];
        this.blank = kwargs['blank'];
        this['null'] = kwargs['null'];

        if (this.empty_strings_allowed && connection.features.interprets_empty_strings_as_nulls)
            this['null'] = true;
        this.rel = kwargs['rel'];
        this.default_value = kwargs['default'];
        this.editable = kwargs['editable'];
        this.serialize = kwargs['serialize'];
        this.unique_for_date = kwargs['unique_for_date'];
        this.unique_for_month = kwargs['unique_for_month'];
        this.unique_for_year = kwargs['unique_for_year'];
        this._choices = kwargs['choices'];
        this.help_text = kwargs['help_text'];
        this.db_column = kwargs['db_column'];
        this.db_tablespace = kwargs['db_tablespace'];
        this.auto_created = kwargs['auto_created'];

        // Set db_index to True if the field has a relationship and doesn't explicitly set db_index.
        this.db_index = kwargs['db_index'];

        // Adjust the appropriate creation counter, and save our local copy.
        if (kwargs['auto_created']) {
            this.creation_counter = Field.auto_creation_counter;
            Field.auto_creation_counter -= 1;
        } else {
            this.creation_counter = Field.creation_counter;
            Field.creation_counter += 1;
        }

    },

    __cmp__: function(other){
        // This is needed because bisect does not take a comparison function.
        return this.creation_counter - other.creation_counter;
    },

    __deepcopy__: function() {
        var obj = copy(this);
        if (this.rel)
            obj.rel = copy(this.rel);
        return obj;
    },

    /*
     * Converts the input value into the expected Python data type, raising
     * doff.core.ValidationError if the data can't be converted.
     * Returns the converted value. Subclasses should override this.
     */
    to_javascript: function(value) {
        return value;
    },

    db_type: function() {
        var ret = connection.creation.data_types[this.get_internal_type()];
        if (!ret)
            return null;
        else
            return ret.subs(this.max_length);
    },

    get unique() {
        return this._unique || this.primary_key;
    },

    set_attributes_from_name: function(name) {
        this.name = name;
        var [attname, column] = this.get_attname_column();
        this.attname = attname;
        this.column = column;
        if (!this.verbose_name && name)
            this.verbose_name = name.replace('_', ' ');
    },

    contribute_to_class: function(cls, name) {
        this.set_attributes_from_name(name);
        cls._meta.add_field(this);
        if (bool(this.choices)) {
            var key = 'get_%s_display'.subs(this.name);
            cls.prototype[key] = curry(cls.prototype._get_FIELD_display, this);
        }
    },

    get_attname: function() {
        return this.name;
    },

    get_attname_column: function() {
        var attname = this.get_attname();
        var column = this.db_column || attname;
        return [attname, column];
    },

    get_cache_name: function() {
        return '_%s_cache'.subs(this.name);
    },

    get_internal_type: function() {
        return this.__class__.__name__;
    },

    /*
	* Returns field's value just before saving.
	*/
    pre_save: function(model_instance, add) {
        return model_instance[this.attname];
    },

    /*
	* Returns field's value prepared for interacting with the database backend.
	* Used by the default implementations of ``get_db_prep_save``and `get_db_prep_lookup```
	*/
    get_db_prep_value: function(value) {
        return value;
    },

    /*
	* Returns field's value prepared for saving into a database.
	*/
    get_db_prep_save: function(value) {
        return this.get_db_prep_value(value);
    },

    get_db_prep_lookup: function(lookup_type, value){
        /* Returns field's value prepared for database lookup. */
        if (callable(value['as_sql']) || callable(value['_as_sql'])) {
            // If the value has a relabel_aliases method, it will need to
            // be invoked before the final SQL is evaluated
            if (callable(value['relabel_aliases']))
                return value;
            if (callable(value['as_sql']))
                var [ sql, params ] = value.as_sql();
            else
                var [ sql, params ] = value._as_sql();
            return new QueryWrapper('(%s)'.subs(sql), params);
        }

        if (include(['regex', 'iregex', 'month', 'day', 'search'], lookup_type))
            return [value];
        else if (include(['exact', 'gt', 'gte', 'lt', 'lte'], lookup_type))
            return [this.get_db_prep_value(value)];
        else if (include(['range', 'in'], lookup_type))
            return [this.get_db_prep_value(v) for each (v in value)];
        else if (include(['contains', 'icontains'], lookup_type))
            return ["%%%s%%".subs(connection.ops.prep_for_like_query(value))];
        else if (lookup_type == 'iexact')
            return [connection.ops.prep_for_iexact_query(value)];
        else if (include(['startswith', 'istartswith'], lookup_type))
            return ["%s%%".subs(connection.ops.prep_for_like_query(value))];
        else if (include(['endswith', 'iendswith'], lookup_type))
            return ["%%%s".subs(connection.ops.prep_for_like_query(value))];
        else if (lookup_type == 'isnull')
            return [];
        else if (lookup_type == 'year') {
            value = Number(value);
            if (isNaN(value))
                throw new ValueError("The __year lookup type requires an integer argument");

            if (this.get_internal_type() == 'DateField')
                return connection.ops.year_lookup_bounds_for_date_field(value);
            else
                return connection.ops.year_lookup_bounds(value);
        }

        throw new TypeError("Field has invalid lookup: %s".subs(lookup_type));
    },

    /*
     * Returns a boolean of whether this field has a default value.
     */
    has_default: function() {
        return this.default_value != NOT_PROVIDED;
    },

    /*
     * Returns the default value for this field
     */
    get_default: function() {
        if (this.has_default()) {
            if (callable(this.default_value))
            return this.default_value();
            return this.default_value;
        }
        if (!this.empty_strings_allowed || (this['null'] && !connection.features.interprets_empty_strings_as_nulls))
            return null;
        return "";
    },

    get_validator_unique_lookup_type: function() {
        return '%s__exact'.subs(this.name);
    },

    /*
     * Returns choices with a default blank choices included, for use as SelectField choices for this field.
     */
    get_choices: function(include_blank, blank_choice) {
        include_blank = include_blank || true;
        blank_choice = blank_choice || BLANK_CHOICE_DASH;
        var first_choice = include_blank && blank_choice || [];
        if (bool(this.choices))
            return first_choice.concat(this.choices);
        var rel_model = this.rel.to;
            //FIXME: no suele andar muy bien esto de indexar con una invocacion
        if (this.rel['get_related_field'])
            lst = [x[this.rel.get_related_field().attname, x] for (x in rel_model._default_manager.complex_filter(this.rel.limit_choices_to))];
        else
            lst = [[x._get_pk_val(), x] for (x in rel_model._default_manager.complex_filter(this.rel.limit_choices_to))];
        return first_choice.concat(lst);
    },

    get_choices_default: function() {
        return this.get_choices();
    },

    /*
     * Returns flattened choices with a default blank choice included.
     */
    get_flatchoices: function(include_blank, blank_choice) {
        include_blank = include_blank || true;
        blank_choice = blank_choice || BLANK_CHOICE_DASH;
        var first_choice = include_blank && blank_choice || [];
        return first_choice.concat(this.flatchoices);
    },

    _get_val_from_obj: function(object) {
        if (object)
            return object[this.attname];
        else
            return this.get_default();
    },

    /*
     * Returns a string value of this field from the passed obj.
     * This is used by the serialization framework.
     */
    value_to_string: function(object) {
        return string(this._get_val_from_obj(object));
    },

    bind: function(fieldmapping, original, bound_field_class) {
        return bound_field_class(this, fieldmapping, original);
    },

    get choices() {
        //TODO: ver que pasa con las choices que son generadores
        if (callable(this._choices['next'])) {
            var choices = array(this._choices);
            this._choices = _choices;
            return choices;
        } else {
            return this._choices;
        }
    },

    /*
     * Flattened version of choices
     */
    get flatchoices() {
        var flat = [];
        for each (var [choice, value] in this.choices)
            if (isinstance(value, Array))
                flat = flat.concat(value);
            else
                flat.push([choice, value])
        return flat;
    },

    save_form_data: function(instance, data) {
        instance[this.name] = data;
    },

    //Returns a django.forms.Field instance for this database Field.
    formfield: function() {
        var arg = new Arguments(arguments);
        var kwargs = arg.kwargs;
        var form_class = kwargs['form_class'] || forms.CharField;
        var defaults = {'required': !this.blank, 'label': this.verbose_name.capitalize(), 'help_text': this.help_text};
        if (this.has_default()) {
            defaults['initial'] = this.get_default();
            if (callable(this.default))
            defaults['show_hidden_initial'] = true;
        }
        if (bool(this.choices)) {
            // Fields with choices get special treatment.
            var include_blank = this.blank || !(this.has_default() || 'initial' in kwargs);
            defaults['choices'] = this.get_choices(include_blank);
            defaults['coerce'] = getattr(this, to_javascript);
            if (this.null)
            defaults['empty_value'] = null;
            var form_class = forms.TypedChoiceField;
            // Many of the subclass-specific formfield arguments (min_value,
            // max_value) don't apply for choice fields, so be sure to only pass
            // the values that TypedChoiceField will understand.
            for each (k in keys(kwargs))
            if (!include(['coerce', 'empty_value', 'choices', 'required', 'widget', 'label', 'initial', 'help_text', 'error_messages'], k))
                delete kwargs[k];
        }
        extend(defaults, kwargs);
        return new form_class(defaults);
    },

    /*
    * Returns the value of this field in the given model instance.
    */
    value_from_object: function(object) {
        return object[this.attname];
    }
});

var AutoField = type('AutoField', [ Field ], {
    empty_strings_allowed: false,
    __init__: function() {
        var arg = new Arguments(arguments);
        assert (bool(arg.kwargs['primary_key']), "%ss must have primary_key = true.".subs(type(this).__name__));
        arg.kwargs['blank'] = true;
        super(Field, this).__init__(arg);
    },

    to_javascript: function(value) {
        if (!value)
            return value;
        var n = Number(value);
        if (isNaN(n))
            throw new ValidationError("This value must be an integer.");
        return n;
    },

    get_db_prep_value: function(value) {
        if (value == null)
            return null;
        return Number(value) || null;
    },

    contribute_to_class: function(cls, name) {
        assert (!cls._meta.has_auto_field, "A model can't have more than one AutoField.");
        super(Field, this).contribute_to_class(cls, name);
        cls._meta.has_auto_field = true;
        cls._meta.auto_field = this;
    },

    formfield: function() {
        return null;
    }
});

var BooleanField = type('BooleanField', [ Field ], {
    __init__: function() {
        var arg = new Arguments(arguments);
        arg.kwargs['blank'] = true;
        if (bool(arg.kwargs['default_value']) && bool(arg.kwargs['null']));
            arg.kwargs['default_value'] = false;
        super(Field, this).__init__(arg);
    },

    to_javascript: function(value) {
        if (value == false || value == true) return value;
        if (include(['t', 'true', '1'], value)) return true;
        if (include(['f', 'false', '0'], value)) return false;
        throw new ValidationError("This value must be either True or False.");
    },

    get_db_prep_lookup: function(lookup_type, value) {
        // Special-case handling for filters coming from a web request (e.g. the
        // admin interface). Only works for scalar values (not lists). If you're
        // passing in a list, you might as well make things the right type when
        // constructing the list.
        if (include(['1', '0'], value));
            value = bool(Number(value));
        return super(Field, this).get_db_prep_lookup(lookup_type, value);
    },

    get_db_prep_value: function(value) {
        if (value == null)
            return null;
        return bool(value);
    },

    formfield: function() {
        var arg = new Arguments(arguments);
        var defaults = {'form_class': forms.BooleanField };
        extend(defaults, arg.kwargs);
        return super(Field, this).formfield(defaults);
    }
});

var CharField = type('CharField', [ Field ], {
    __init__: function() {
        var arg = new Arguments(arguments);
        arg.kwargs['max_length'] = arg.kwargs['max_length'] || 100;
        super(Field, this).__init__(arg);
    },

    get_internal_type: function() {
        return 'CharField';
    },

    to_javascript: function(value) {
        if (isinstance(value, String))
            return value;
        if (value == null)
            if (this['null'])
            	return value;
            else
            	throw new ValidationError("This field cannot be null.");
        return string(value);
    },

    formfield: function() {
        var arg = new Arguments(arguments);
        var defaults = {'max_length': this.max_length};
        extend(defaults, arg.kwargs);
        return super(Field, this).formfield(defaults);
    }
});

var ansi_date_re = /^\d{4}-\d{1,2}-\d{1,2}$/;
var ansi_time_re = /^(0[1-9]|1\d|2[0-3]):([0-5]\d):([0-5]\d)$/;

var DateField = type('DateField', [ Field ], {
    empty_strings_allowed: false,
    __init__: function() {
        var arg = new Arguments(arguments, {'verbose_name':null, 'name':null, 'auto_now':false, 'auto_now_add':false});
        this.auto_now = arg.kwargs['auto_now'];
        this.auto_now_add = arg.kwargs['auto_now_add'];
        //auto_now_add/auto_now should be done as a default or a pre_save.
        if (this.auto_now || this.auto_now_add) {
            arg.kwargs['editable'] = false;
            arg.kwargs['blank'] = true;
        }
        super(Field, this).__init__(arg);
    },

    to_javascript: function(value) {
        if (value == null)
            return value;
        if (isinstance(value, Date))
            return value;
        if (value.search(ansi_date_re) != 0)
            throw new ValidationError('Enter a valid date in YYYY-MM-DD format.');
        var [year, month, day] = value.split('-').map(function(simbol) {return Number(simbol)});

        return new Date(year, month, day);
    },

    pre_save: function(model_instance, add) {
        if (this.auto_now || (this.auto_now_add && add)) {
            value = new Date();
            model_instance[this.attname] = value;
            return value;
        } else
            return super(Field, this).pre_save(model_instance, add);
    },

    contribute_to_class: function(cls, name) {
        super(Field, this).contribute_to_class(cls, name);
        if (!this['null']) {
            var key = 'get_next_by_%s'.subs(this.name);
            cls.prototype[key] = curry(cls.prototype._get_next_or_previous_by_FIELD, this, true);
            key = 'get_previous_by_%s'.subs(this.name);
            cls.prototype[key] = curry(cls.prototype._get_next_or_previous_by_FIELD, this, false);
        }
    },

    get_db_prep_lookup: function(lookup_type, value) {
        // For "__month" and "__day" lookups, convert the value to a string so
        // the database backend always sees a consistent type.
        if (include(['month', 'day'], lookup_type))
            return [new String(value)];
        return super(Field, this).get_db_prep_lookup(lookup_type, value);
    },

    get_db_prep_value: function(value) {
        // Casts dates into the format expected by the backend
        return connection.ops.value_to_db_date(this.to_javascript(value));
    },

    value_to_string: function(obj) {
        var val = this._get_val_from_obj(obj);
        if (!bool(val))
            return '';
        if (!isinstance(val, Date))
        	val = new Date(val);
        return '%04d-%02d-%02d'.subs(val.getFullYear(), 
        							 val.getUTCMonth() + 1,  // JavaScript reports January as year 0
        							 val.getUTCDate());
    },

    formfield: function() {
        var arg = new Arguments(arguments);
        var defaults = {'form_class': forms.DateField };
        extend(defaults, arg.kwargs);
        return super(Field, this).formfield(defaults);
    }
});

var DateTimeField = type('DateTimeField', [ DateField ], {

    to_javascript: function(value) {
        if (!value)
            return value;
        if (isinstance(value, Date))
            return value;
        if (isinstance(value, Number))
        	return new Date(value);
        if (isinstance(value, String)) {
	        var matches;
	        if(matches = value.match(/^(?:(\d\d\d\d)-(\d\d)(?:-(\d\d)(?:T| (\d\d)(?::(\d\d)(?::(\d\d)(?:\.(\d+))?)?)?)?)?)$/)){
	        	value = new Date();
	            if (matches[1])
	            	value.setUTCFullYear(Number(matches[1]));
	            if (matches[2])
	            	value.setUTCMonth(Number(matches[2]) - 1);
	            if (matches[3])
	            	value.setUTCDate(Number(matches[3]));
	            if (matches[4])
	            	value.setUTCHours(Number(matches[4]));
	            if (matches[5])
	            	value.setUTCMinutes(Number(matches[5]));
	            if (matches[6])
	            	value.setUTCSeconds(Number(matches[6]));
	        } else if (matches = value.match(/^@(\d+)@$/)) {
	        	value = new Date(Number(matches[1]));
	        } else if (matches = value.match(/^\/Date\((\d+)\)\/$/)) {
	        	value = new Date(Number(matches[1]));
	        }
	        return value;
        }
        throw new Exception('Implementame DateTimeField para %s'.subs(value));
    },

    get_db_prep_value: function(value) {
        // Casts dates into the format expected by the backend
        return connection.ops.value_to_db_datetime(this.to_javascript(value));
    },

    value_to_string: function(obj) {
        var val = this._get_val_from_obj(obj);
        if (!bool(val))
            return '';
        if (!isinstance(val, Date))
        	val = new Date(val);
        return '%04d-%02d-%02d %02d:%02d:%02d'.subs(val.getFullYear(), 
        											val.getUTCMonth() + 1,  // JavaScript reports January as year 0
        											val.getUTCDate(), 
        											val.getUTCHours(), 
        											val.getUTCMinutes(), 
        											val.getUTCSeconds());
    },

    formfield: function() {
        var arg = new Arguments(arguments);
        var defaults = {'form_class': forms.DateTimeField };
        extend(defaults, arg.kwargs);
        return super(DateField, this).formfield(defaults);
    }
});

var DecimalField = type('DecimalField', [ Field ], {
    empty_strings_allowed: false,
    __init__: function() {
        var arg = new Arguments(arguments, {'verbose_name':null, 'name':null, 'max_digits':null, 'decimal_places':null});
        this.max_digits = arg.kwargs['max_digits'];
        this.decimal_places = arg.kwargs['decimal_places'];
        super(Field, this).__init__(arg);
    },

    to_javascript: function(value) {
        if (!value)
            return value;
        return Number(value);
    },

    _format: function(value) {
        if (type(value) == String || !value)
            return value;
        else
            return this.format_number(value);
    },

    /*
     * Formats a number into a string with the requisite number of digits and decimal places.
     */
    format_number: function(value) {
        var util = require('doff.db.backends.util');
        return util.format_number(value, this.max_digits, this.decimal_places);
    },

    value_to_string: function(object) {
        return this.format_number(this._get_val_from_obj(object));
    },
    
    get_db_prep_value: function(value) {
    	return connection.ops.value_to_db_decimal(this.to_javascript(value), this.max_digits, this.decimal_places);
    },
    
    formfield: function() {
        var arg = new Arguments(arguments);
        var defaults = {
            'max_digits': this.max_digits,
            'decimal_places': this.decimal_places,
            'form_class': forms.DecimalField
        }
        extend(defaults, arg.kwargs);
        return super(Field, this).formfield(defaults);
    }
});

var EmailField = type('EmailField', [ CharField ], {
    __init__: function __init__() {
        var arg = new Arguments(arguments);
        arg.kwargs['max_length'] = arg.kwargs['max_length'] || 75;
        super(CharField, this).__init__(arg);
    },

    formfield: function() {
        var arg = new Arguments(arguments);
        var defaults = {'form_class': forms.EmailField };
        extend(defaults, arg.kwargs);
        return super(CharField, this).formfield(defaults);
    }
});

var FilePathField = type('FilePathField', [ Field ], {
    __init__: function() {
        var arg = new Arguments(arguments, {'verbose_name':null, 'name':null, 'path':'', 'match':null, 'recursive':false});
        this.path = arg.kwargs['path'];
        this.match = arg.kwargs['match'];
        this.recursive = arg.kwargs['recursive'];
        arg.kwargs['max_length'] = arg.kwargs['max_length'] || 100;
        super(Field, this).__init__(arg);
    },

    formfield: function() {
        var arg = new Arguments(arguments);
        var defaults = {
            'path': this.path,
            'match': this.match,
            'recursive': this.recursive,
            'form_class': forms.FilePathField
        }
        extend(defaults, arg.kwargs);
        return super(Field, this).formfield(defaults);
    }
});

var FloatField = type('FloatField', [ Field ], {
    empty_strings_allowed: false,

    get_db_prep_value: function(value) {
        if (!value)
            return null;
        return Number(value);
    },
    
    formfield: function() {
        var arg = new Arguments(arguments);
        var defaults = {'form_class': forms.FloatField };
        extend(defaults, arg.kwargs);
        return super(Field, this).formfield(defaults);
    }
});

var IntegerField = type('IntegerField', [ Field ], {
    empty_strings_allowed: false,
    get_db_prep_value: function(value) {
        if (!value)
            return null;
        return Number(value);
    },

    to_javascript: function(value) {
        if (!value)
            return value;
        var n = Number(value);
        if (isNaN(n)) {
            throw new ValidationError("This value must be an integer.");
        }
        return n;
    },

    formfield: function() {
        var arg = new Arguments(arguments);
        var defaults = {'form_class': forms.IntegerField };
        extend(defaults, arg.kwargs);
        return super(Field, this).formfield(defaults);
    }
});

var IPAddressField = type('IPAddressField', [ Field ], {
    empty_strings_allowed: false,
    __init__: function() {
        var arg = new Arguments(arguments);
        arg.kwargs['max_length'] = 15;
        super(Field, this).__init__(arg);
    },

    formfield: function() {
        var arg = new Arguments(arguments);
        var defaults = {'form_class': forms.IPAddressField};
        extend(defaults, arg.kwargs);
        return super(Field, this).formfield(defaults);
    }
});

var NullBooleanField = type('NullBooleanField', [ Field ], {
    empty_strings_allowed: false,
    __init__: function() {
        var arg = new Arguments(arguments);
        arg.kwargs['null'] = true;
        super(Field, this).__init__(arg);
    },

    to_javascript: function(value) {
        if (value == false || value == true || value == null) return value;
        if ('null' == value) return null;
        if (include(['t', 'true', '1'], value)) return true;
        if (include(['f', 'false', '0'], value)) return false;
        throw new ValidationError("This value must be either null, true or false.");
    },

    get_db_prep_lookup: function(lookup_type, value) {
        // Special-case handling for filters coming from a web request (e.g. the
        // admin interface). Only works for scalar values (not lists). If you're
        // passing in a list, you might as well make things the right type when
        // constructing the list.
        if (include(['1', '0'], value))
            value = bool(Number(value));
        return super(Field, this).get_db_prep_lookup(lookup_type, value);
    },

    get_db_prep_value: function(value) {
        if (value == null)
            return null;
        return bool(value);
    },
    
    formfield: function() {
        var arg = new Arguments(arguments);
        var defaults = {
            'form_class': forms.NullBooleanField,
            'required':  !this.blank,
            'label': capfirst(this.verbose_name),
            'help_text': this.help_text
        }
        extend(defaults, arg.kwargs);
        return super(Field, this).formfield(defaults);
    }
});

var PositiveIntegerField = type('PositiveIntegerField', [ IntegerField ], {
    formfield: function() {
        var arg = new Arguments(arguments);
        var defaults = {'min_value': 0};
        extend(defaults, arg.kwargs);
        return super(IntegerField, this).formfield(defaults);
    }
});

var PositiveSmallIntegerField = type('PositiveSmallIntegerField', [ IntegerField ], {
    formfield: function() {
        var arg = new Arguments(arguments);
        var defaults = {'min_value': 0};
        extend(defaults, arg.kwargs);
        return super(IntegerField, this).formfield(defaults);
    }
});

var SlugField = type('SlugField', [ CharField ], {
    __init__: function() {
        var arg = new Arguments(arguments);
        arg.kwargs['max_length'] = arg.kwargs['max_length'] || 50;
        // Set db_index = true unless it's been set manually.
        if (!arg.kwargs['db_index'])
            arg.kwargs['db_index'] = true;
        super(CharField, this).__init__(arg);
    },

    formfield: function formfield() {
        var arg = new Arguments(arguments);
        var defaults = {'form_class': forms.SlugField };
        extend(defaults, arg.kwargs);
        return super(CharField, this).formfield(defaults);
    }
});

var SmallIntegerField = type('SmallIntegerField', [ IntegerField ]);

var TextField = type('TextField', [ Field ], {
    formfield: function() {
        var arg = new Arguments(arguments);
        var defaults = {'widget': forms.Textarea };
        extend(defaults, arg.kwargs);
        return super(Field, this).formfield(defaults);
    }
});

var TimeField = type('TimeField', [ Field ], {
    empty_strings_allowed: false,
    __init__: function() {
        var arg = new Arguments(arguments, {'verbose_name':null, 'name':null, 'auto_now':false, 'auto_now_add':false});
        this.auto_now = arg.kwargs['auto_now'];
        this.auto_now_add = arg.kwargs['auto_now_add'];
        if (this.auto_now || this.auto_now_add)
            arg.kwargs['editable'] = false;
        super(Field, this).__init__.(arg);
    },

    to_javascript: function(value) {
        if (value == null)
            return null;
        if (isinstance(value, Date))
            return value;

            /* TODO validar la fecha
        # Attempt to parse a datetime:
        value = smart_str(value)
        # split usecs, because they are not recognized by strptime.
        if '.' in value:
            try:
            value, usecs = value.split('.')
            usecs = int(usecs)
            except ValueError:
            raise ValidationError(
                _('Enter a valid time in HH:MM[:ss[.uuuuuu]] format.'))
        else:
            usecs = 0
        kwargs = {'microsecond': usecs}

        try: # Seconds are optional, so try converting seconds first.
            return datetime.time(*time.strptime(value, '%H:%M:%S')[3:6],
                        **kwargs)
        except ValueError:
            try: # Try without seconds.
            return datetime.time(*time.strptime(value, '%H:%M')[3:5],
                            **kwargs)
            except ValueError:
            raise ValidationError(
                _('Enter a valid time in HH:MM[:ss[.uuuuuu]] format.'))
        */
    },

    pre_save: function(model_instance, add) {
        if (this.auto_now || (this.auto_now_add && add)) {
            value = new Date();
            model_instance[this.attname] = value;
            return value;
        }
        else
            return super(Field, this).pre_save(model_instance, add);
    },

    get_db_prep_value: function(value) {
        // Casts times into the format expected by the backend
        return connection.ops.value_to_db_time(this.to_javascript(value));
    },

    value_to_string: function(obj) {
    	var val = this._get_val_from_obj(obj);
        if (!bool(val))
            return '';
        if (!isinstance(val, Date))
        	val = new Date(val);
        return '%02d:%02d:%02d'.subs(val.getUTCHours(), 
        							 val.getUTCMinutes(), 
        							 val.getUTCSeconds());
    },

    formfield: function() {
        var arg = new Arguments(arguments);
        var defaults = {'form_class': forms.TimeField }
        extend(defaults, arg.kwargs);
        return super(Field, this).formfield(defaults);
    }
});

var URLField = type('URLField', CharField, {
    __init__: function() {
        var arg = new Arguments(arguments, {'verbose_name':null, 'name':null, 'verify_exists':true});
        arg.kwargs['max_length'] = arg.kwargs['max_length'] || 200;
        this.verify_exists = arg.kwargs['verify_exists'];
        super(CharField, this).__init__(arg);
    },
  
    formfield: function() {
        var arg = new Arguments(arguments);
        var defaults = {'form_class': forms.URLField, 'verify_exists': this.verify_exists };
        extend(defaults, arg.kwargs);
        return super(CharField, this).formfield(defaults);
    }
});

publish({ 
    FieldDoesNotExist: FieldDoesNotExist, 
    Field: Field,
    AutoField: AutoField,
    BooleanField: BooleanField,
    CharField: CharField,
    DateField: DateField,
    DateTimeField: DateTimeField,
    DecimalField: DecimalField,
    EmailField: EmailField,
    FilePathField: FilePathField,
    FloatField: FloatField,
    IntegerField: IntegerField,
    IPAddressField: IPAddressField,
    NullBooleanField: NullBooleanField,
    PositiveIntegerField: PositiveIntegerField,
    PositiveSmallIntegerField: PositiveSmallIntegerField,
    SlugField: SlugField,
    SmallIntegerField: SmallIntegerField,
    TextField: TextField,
    TimeField: TimeField,
    URLField: URLField
});
