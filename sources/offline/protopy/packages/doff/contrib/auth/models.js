require('doff.contrib.extradata.models', 'ExtraData');
require('json', 'stringify');

function check_password(raw_password, enc_password) {
    var [algo, salt, hsh] = enc_password.split('$');
    if (algo == 'md5') {
    	require('md5', 'md5');
    	return hsh == md5(salt + raw_password);
    } else if (algo == 'sha1') {
    	require('sha1', 'sha1');
    	return hsh == sha1(salt + raw_password);
    }
    throw new ValueError("Got unknown password algorithm type in password.");
}

var User = type('User', [ object ], {
	get: function() {
		var kwargs = new Arguments(arguments).kwargs;
		try {
			var obj = ExtraData.objects.get({'name': 'User', 'module': 'doff.contrib.auth.models', 'key': kwargs['username']});
			return new User(obj.data);
		} catch (e) {
			
		}
	}
}, {
    
	__init__: function(data) {
		extend(this, data);
	},
	
	__json__: function() {
		var keys = ["username", "first_name", "last_name", "is_active", "email", "is_superuser", "is_staff", "password" ];
		var data = {};
		for each (var key in keys)
			data[key] = this[key];
		return stringify(data);
	},
	
	save: function() {
		var ed = new ExtraData();
		ed.data = this;
		ed.key = this.username;
		ed.save();
	},
	
    is_anonymous: function(){ return false;},
    is_authenticated: function(){ return true;},
    get_full_name: function() { 
    	var full_name = '%s %s'.subs(this.first_name, this.last_name);
    	return full_name.strip();
    },
    
    check_password: function(raw_password) {
        return check_password(raw_password, this.password);
    }
});
    
    
var AnonymousUser = type('AnonymousUser', [ object ], {
    username: '',
    
    is_anonymous: function(){ return true;},
    is_authenticated: function(){ return false;}
});
    
publish({
	User: User,
	AnonymousUser: AnonymousUser
});